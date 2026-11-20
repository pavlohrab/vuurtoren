//! Vuurtoren desktop: the whole app on this computer.
//!
//! The window shows the bundled web build (the "home" page). Its data is one SQLite file in a
//! visible folder (`db.rs`, `~/Documents/Vuurtoren/vuurtoren.sqlite`) and its language server is
//! the bundled sidecar (`sidecar.rs`), reached through the `vuurtoren-nlp:` protocol
//! (`proxy.rs`). Other devices come together with it through sync (`sync.rs`).
//!
//! The page gets `window.__VUURTOREN_DESKTOP__` (see `bridge.js`): AnkiConnect requests sent
//! from Rust (no webCorsOriginList setup), the database, sync and the language server. Closing
//! the window first lets the page send its last changes (`close_now`).

mod db;
mod keys;
mod proxy;
mod sidecar;
mod sync;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value as Json;
use tauri::ipc::InvokeBody;
use tauri::webview::{DownloadEvent, NewWindowResponse};
use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;

const MAIN: &str = "main";
/// The only addresses the Anki bridge may reach (AnkiConnect's default port, this machine).
const ANKI_HOSTS: [&str; 2] = ["127.0.0.1", "localhost"];
const ANKI_PORT: u16 = 8765;
/// Update feed: the `latest.json` of the newest GitHub release (public repo). CI may override it
/// at build time with the `VUURTOREN_UPDATE_URL` repository variable.
const DEFAULT_UPDATE_URL: &str =
    "https://github.com/pavlohrab/Vuurtoren/releases/latest/download/latest.json";
const BUILD_UPDATE_URL: Option<&str> = match option_env!("VUURTOREN_UPDATE_URL") {
    Some(url) if !url.is_empty() => Some(url),
    _ => Some(DEFAULT_UPDATE_URL),
};

/// How long closing the window waits for the page's last sync.
const CLOSE_WAIT: Duration = Duration::from_secs(5);

/// What the app remembers between starts (`<config dir>/desktop.json`).
#[derive(Default, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
struct Config {
    /// Overrides the update feed (a `latest.json` URL); empty string turns updates off.
    update_url: Option<String>,
    /// The database file; unset: `<Documents>/Vuurtoren/vuurtoren.sqlite`.
    database: Option<String>,
    /// Folders the user picked to sync through; the page may only reach files inside these.
    sync_roots: Vec<String>,
    /// Addresses (`https://host:port`) the user allowed sync requests to; `sync_fetch` reaches
    /// nothing else.
    sync_hosts: Vec<String>,
}

/// The open local database and the lock this process holds on it.
struct OpenDb {
    conn: rusqlite::Connection,
    path: PathBuf,
    me: db::LockInfo,
}

struct State {
    config: Mutex<Config>,
    path: PathBuf,
    client: reqwest::Client,
    /// For sync places: redirects only within the same address (`sync::redirect_policy`).
    sync_client: reqwest::Client,
    /// Sync addresses the user declined since the app started (not asked again until restart).
    sync_declined: Mutex<Vec<String>>,
    /// The fallback file for the sync key (`keys.rs`), in the app data folder.
    key_file: PathBuf,
    db: Mutex<Option<OpenDb>>,
    sidecar: sidecar::Sidecar,
    /// The default database file (`<Documents>/Vuurtoren/vuurtoren.sqlite`).
    default_db: PathBuf,
    /// The page finished its last sync (or took too long): the window may close.
    closing: AtomicBool,
}

impl State {
    fn save(&self, config: &Config) -> Result<(), String> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
        std::fs::write(&self.path, json).map_err(|e| e.to_string())
    }
}

/// The bundled web build's address (the dev server under `tauri dev`).
fn home_url(app: &AppHandle) -> Url {
    #[cfg(debug_assertions)]
    if let Some(dev) = app.config().build.dev_url.clone() {
        return dev;
    }
    let _ = app;
    let home = if cfg!(windows) {
        "http://tauri.localhost/"
    } else {
        "tauri://localhost/"
    };
    Url::parse(home).expect("valid home url")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopInfo {
    version: String,
    /// Base URL of the bundled language server (the `vuurtoren-nlp:` protocol).
    nlp_base: &'static str,
}

#[tauri::command]
fn desktop_info(app: AppHandle) -> DesktopInfo {
    DesktopInfo {
        version: app.package_info().version.to_string(),
        nlp_base: proxy::base_url(),
    }
}

/// Closing the window: the page sends its last changes first (`window.__VUURTOREN_CLOSING__`
/// in bridge.js, at most about 5 s), then calls `close_now`. A page that never answers is
/// closed after `CLOSE_WAIT`.
fn on_close_requested(window: &tauri::Window, api: &tauri::CloseRequestApi) {
    let state = window.state::<State>();
    if state.closing.load(Ordering::SeqCst) {
        return;
    }
    api.prevent_close();
    let app = window.app_handle().clone();
    let asked = window.get_webview_window(window.label()).is_some_and(|page| {
        page.eval(
            "window.__VUURTOREN_CLOSING__ ? window.__VUURTOREN_CLOSING__() : window.__TAURI_INTERNALS__.invoke('close_now')",
        )
        .is_ok()
    });
    if !asked {
        close_window(&app);
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(CLOSE_WAIT).await;
        close_window(&app);
    });
}

/// Close the main window for good (the close request is not intercepted again).
fn close_window(app: &AppHandle) {
    let state = app.state::<State>();
    if state.closing.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.close();
    }
}

/// The page sent its last changes (or has none): close the window.
#[tauri::command]
fn close_now(app: AppHandle) {
    close_window(&app);
}

#[derive(Deserialize)]
struct AnkiRequest {
    url: String,
    method: Option<String>,
    body: Option<String>,
    /// Milliseconds (default and cap: 5 minutes; the page aborts earlier with its own timeout).
    timeout: Option<u64>,
}

#[derive(Serialize)]
struct AnkiResponse {
    status: u16,
    body: String,
}

/// Is this AnkiConnect on this machine (the only address the bridge may reach)?
fn is_anki_url(url: &Url) -> bool {
    url.scheme() == "http"
        && url.port_or_known_default() == Some(ANKI_PORT)
        && url.host_str().is_some_and(|h| ANKI_HOSTS.contains(&h))
}

/// AnkiConnect, sent from Rust: no browser Origin header, so no webCorsOriginList entry is
/// needed.
#[tauri::command]
async fn anki_fetch(
    req: AnkiRequest,
    state: tauri::State<'_, State>,
) -> Result<AnkiResponse, String> {
    let url = Url::parse(&req.url).map_err(|_| "invalid AnkiConnect address".to_string())?;
    if !is_anki_url(&url) {
        return Err(format!(
            "the desktop app only reaches AnkiConnect at http://127.0.0.1:{ANKI_PORT}"
        ));
    }
    let timeout = Duration::from_millis(req.timeout.unwrap_or(300_000).min(300_000));
    let builder = match req.method.as_deref().unwrap_or("POST") {
        "GET" => state.client.get(url),
        "POST" => state.client.post(url).body(req.body.unwrap_or_default()),
        other => return Err(format!("method {other} not allowed")),
    };
    let res = builder.timeout(timeout).send().await.map_err(|e| {
        if e.is_timeout() {
            "timeout".to_string()
        } else {
            format!("cannot reach AnkiConnect: {e}")
        }
    })?;
    let status = res.status().as_u16();
    let body = res.text().await.map_err(|e| e.to_string())?;
    Ok(AnkiResponse { status, body })
}

// ------------------------------------------------------------------ local database

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DbOpened {
    /// The database file.
    path: String,
    /// True when the file did not exist before (first start).
    created: bool,
    /// Sync-tool conflict copies next to the file (names), to warn about.
    conflicts: Vec<String>,
    /// Set (and nothing opened) when another computer has the file open.
    locked: Option<db::LockInfo>,
}

fn db_path(state: &State) -> PathBuf {
    state
        .config
        .lock()
        .unwrap()
        .database
        .as_ref()
        .map(PathBuf::from)
        .unwrap_or_else(|| state.default_db.clone())
}

fn this_process() -> db::LockInfo {
    let now = db::now();
    db::LockInfo {
        app: "vuurtoren".into(),
        host: db::hostname(),
        pid: std::process::id(),
        since: now,
        seen: now,
    }
}

fn close_db(state: &State) {
    if let Some(open) = state.db.lock().unwrap().take() {
        drop(open.conn);
        db::release_lock(&open.path, &open.me);
    }
}

/// Open (or create) the database file. With `force`, a lock held by another computer is taken
/// over (the user chose "Open anyway").
#[tauri::command]
async fn db_open(force: bool, state: tauri::State<'_, State>) -> Result<DbOpened, String> {
    let mut guard = state.db.lock().unwrap();
    if let Some(open) = guard.as_ref() {
        return Ok(DbOpened {
            path: open.path.to_string_lossy().into(),
            created: false,
            conflicts: db::conflict_copies(&open.path),
            locked: None,
        });
    }
    let path = db_path(&state);
    let me = this_process();
    if let Err(other) = db::acquire_lock(&path, &me, force) {
        return Ok(DbOpened {
            path: path.to_string_lossy().into(),
            created: false,
            conflicts: vec![],
            locked: Some(other),
        });
    }
    let created = !path.exists();
    let conn = match db::open_conn(&path) {
        Ok(conn) => conn,
        Err(e) => {
            db::release_lock(&path, &me);
            return Err(e);
        }
    };
    let conflicts = db::conflict_copies(&path);
    *guard = Some(OpenDb {
        conn,
        path: path.clone(),
        me,
    });
    Ok(DbOpened {
        path: path.to_string_lossy().into(),
        created,
        conflicts,
        locked: None,
    })
}

fn with_db<T>(
    state: &State,
    f: impl FnOnce(&mut OpenDb) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = state.db.lock().unwrap();
    let open = guard.as_mut().ok_or("The database is not open.")?;
    f(open)
}

#[tauri::command]
async fn db_exec(
    sql: String,
    params: Vec<Json>,
    state: tauri::State<'_, State>,
) -> Result<Vec<Json>, String> {
    with_db(&state, |open| db::page_exec(&open.conn, &sql, &params))
}

#[tauri::command]
async fn db_close(state: tauri::State<'_, State>) -> Result<(), String> {
    close_db(&state);
    Ok(())
}

/// The whole database as a SQLite file (raw bytes; Settings > Data > Download backup).
#[tauri::command]
async fn db_export(
    app: AppHandle,
    state: tauri::State<'_, State>,
) -> Result<tauri::ipc::Response, String> {
    let scratch = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("export.sqlite");
    if let Some(dir) = scratch.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let bytes = with_db(&state, |open| db::export(&open.conn, &scratch))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Replace the database with a backup (raw bytes; headers `x-device-id`, `x-max-schema`). The
/// file is checked first; the old one stays next to it as `vuurtoren.sqlite.before-restore`.
#[tauri::command]
async fn db_import(
    request: tauri::ipc::Request<'_>,
    state: tauri::State<'_, State>,
) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected the backup file as raw bytes".into());
    };
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string)
    };
    let device_id = header("x-device-id").ok_or("missing device id")?;
    let max_schema: i64 = header("x-max-schema")
        .and_then(|v| v.parse().ok())
        .ok_or("missing schema version")?;
    with_db(&state, |open| {
        let name = open
            .path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let restore = open.path.with_file_name(format!("{name}.restore"));
        let before = open.path.with_file_name(format!("{name}.before-restore"));
        std::fs::write(&restore, bytes).map_err(|e| e.to_string())?;
        if let Err(e) = db::prepare_import(&restore, max_schema, &device_id) {
            let _ = std::fs::remove_file(&restore);
            return Err(e);
        }
        // Close, swap the files, reopen; on failure put the old file back.
        let old = std::mem::replace(
            &mut open.conn,
            rusqlite::Connection::open_in_memory().map_err(|e| e.to_string())?,
        );
        drop(old);
        let _ = std::fs::remove_file(&before);
        std::fs::rename(&open.path, &before).map_err(|e| e.to_string())?;
        if let Err(e) = std::fs::rename(&restore, &open.path) {
            let _ = std::fs::rename(&before, &open.path);
            open.conn = db::open_conn(&open.path)?;
            return Err(e.to_string());
        }
        match db::open_conn(&open.path) {
            Ok(conn) => {
                open.conn = conn;
                Ok(())
            }
            Err(e) => {
                let _ = std::fs::rename(&before, &open.path);
                open.conn = db::open_conn(&open.path)?;
                Err(e)
            }
        }
    })
}

/// Show the database file in the system file manager.
#[tauri::command]
async fn db_reveal(app: AppHandle, state: tauri::State<'_, State>) -> Result<(), String> {
    let path = db_path(&state);
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| e.to_string())
}

/// Move the database to a folder the user picks: a consistent copy is written there, the app
/// switches to it, and the old file is left where it was. None when the user cancelled.
#[tauri::command]
async fn db_move(app: AppHandle, state: tauri::State<'_, State>) -> Result<Option<String>, String> {
    let current = db_path(&state);
    let mut picker = app.dialog().file().set_title("Move the Vuurtoren data to…");
    if let Some(dir) = current.parent() {
        picker = picker.set_directory(dir);
    }
    let Some(dir) = picker.blocking_pick_folder() else {
        return Ok(None);
    };
    let dir = dir.into_path().map_err(|e| e.to_string())?;
    let target = move_target(&current, &dir)?;
    with_db(&state, |open| {
        open.conn
            .execute("VACUUM INTO ?1", [target.to_string_lossy()])
            .map_err(|e| format!("Could not write {}: {e}", target.display()))?;
        let conn = db::open_conn(&target)?;
        db::release_lock(&open.path, &open.me);
        let _ = db::acquire_lock(&target, &open.me, true);
        open.conn = conn;
        open.path = target.clone();
        Ok(())
    })?;
    let mut config = state.config.lock().unwrap();
    config.database = Some(target.to_string_lossy().into());
    state.save(&config)?;
    Ok(Some(target.to_string_lossy().into()))
}

// ------------------------------------------------------------------ sync

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

/// Pick the folder to sync through (one Syncthing, Dropbox or iCloud Drive already syncs).
/// None when the user cancelled.
#[tauri::command]
async fn sync_pick_folder(
    app: AppHandle,
    state: tauri::State<'_, State>,
) -> Result<Option<String>, String> {
    let picker = app
        .dialog()
        .file()
        .set_title("Choose the folder to sync Vuurtoren through");
    let Some(dir) = picker.blocking_pick_folder() else {
        return Ok(None);
    };
    let dir = dir
        .into_path()
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .into_owned();
    let mut config = state.config.lock().unwrap();
    if !config.sync_roots.contains(&dir) {
        config.sync_roots.push(dir.clone());
        state.save(&config)?;
    }
    Ok(Some(dir))
}

fn sync_root(state: &State, root: &str) -> Result<PathBuf, String> {
    sync::allowed_root(root, &state.config.lock().unwrap().sync_roots)
}

#[tauri::command]
async fn sync_dir_list(
    root: String,
    dir: String,
    state: tauri::State<'_, State>,
) -> Result<Vec<String>, String> {
    sync::list(&sync_root(&state, &root)?, &dir)
}

/// A file of the sync folder as base64, or None when it does not exist.
#[tauri::command]
async fn sync_dir_get(
    root: String,
    path: String,
    state: tauri::State<'_, State>,
) -> Result<Option<String>, String> {
    use base64::Engine as _;
    Ok(sync::get(&sync_root(&state, &root)?, &path)?.map(|b| B64.encode(b)))
}

#[tauri::command]
async fn sync_dir_put(
    root: String,
    path: String,
    data: String,
    state: tauri::State<'_, State>,
) -> Result<(), String> {
    use base64::Engine as _;
    let bytes = B64
        .decode(data)
        .map_err(|_| "The file did not arrive whole.".to_string())?;
    sync::put(&sync_root(&state, &root)?, &path, &bytes)
}

#[tauri::command]
async fn sync_dir_remove(
    root: String,
    path: String,
    state: tauri::State<'_, State>,
) -> Result<(), String> {
    sync::remove(&sync_root(&state, &root)?, &path)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncRequest {
    url: String,
    method: String,
    #[serde(default)]
    headers: std::collections::HashMap<String, String>,
    body_base64: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncResponse {
    status: u16,
    headers: std::collections::HashMap<String, String>,
    body_base64: String,
}

/// Allow sync requests to the address of `url` (a sync place the user just set up). The first
/// time, the app asks the user itself, so a page cannot quietly send requests elsewhere.
#[tauri::command]
async fn sync_allow_host(
    url: String,
    app: AppHandle,
    state: tauri::State<'_, State>,
) -> Result<(), String> {
    let (parsed, _) = sync::check_request(&url, "GET")?;
    let origin = sync::origin(&parsed);
    if state.config.lock().unwrap().sync_hosts.contains(&origin) {
        return Ok(());
    }
    let host = parsed.host_str().unwrap_or_default().to_string();
    // Asked once per start: automatic syncs do not bring the question back every minute.
    let not_allowed = || {
        format!("Sync with {host} was not allowed. To allow it after all, restart Vuurtoren and sync again.")
    };
    if state.sync_declined.lock().unwrap().contains(&origin) {
        return Err(not_allowed());
    }
    let plain = if parsed.scheme() == "http" {
        "\n\nThis address does not use https, so use it only on a network you trust."
    } else {
        ""
    };
    let dialog = app
        .dialog()
        .message(format!(
            "Vuurtoren will send your encrypted sync files to {origin}.{plain}\n\nAllow this only for a sync place you set up yourself."
        ))
        .title(format!("Sync with {host}?"))
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Allow".into(),
            "Cancel".into(),
        ));
    let allowed = tauri::async_runtime::spawn_blocking(move || dialog.blocking_show())
        .await
        .unwrap_or(false);
    if !allowed {
        state.sync_declined.lock().unwrap().push(origin);
        return Err(not_allowed());
    }
    let mut config = state.config.lock().unwrap();
    if !config.sync_hosts.contains(&origin) {
        config.sync_hosts.push(origin);
        state.save(&config)?;
    }
    Ok(())
}

/// A request to a sync place (WebDAV, a Vuurtoren server), sent from Rust: no browser Origin, so
/// no CORS setup on that server. Only to addresses the user allowed (`sync_allow_host`); no
/// cookies, no redirects to another address, and the answer is read only up to `MAX_BODY`.
#[tauri::command]
async fn sync_fetch(
    req: SyncRequest,
    state: tauri::State<'_, State>,
) -> Result<SyncResponse, String> {
    use base64::Engine as _;
    let (url, method) = sync::check_request(&req.url, &req.method)?;
    if !state
        .config
        .lock()
        .unwrap()
        .sync_hosts
        .contains(&sync::origin(&url))
    {
        return Err(format!(
            "Sync with {} is not allowed yet. Set up the sync place again in Settings.",
            url.host_str().unwrap_or_default()
        ));
    }
    let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
    let mut builder = state
        .sync_client
        .request(method, url)
        .timeout(Duration::from_secs(120));
    for (name, value) in sync::request_headers(&req.headers) {
        builder = builder.header(name, value);
    }
    if let Some(body) = req.body_base64 {
        let bytes = B64
            .decode(body)
            .map_err(|_| "The request body did not arrive whole.".to_string())?;
        if bytes.len() > sync::MAX_BODY {
            return Err("This file is too large to sync.".into());
        }
        builder = builder.body(bytes);
    }
    let res = builder.send().await.map_err(|e| {
        if e.is_timeout() {
            "The sync place did not answer in time.".to_string()
        } else {
            format!("Cannot reach the sync place: {e}")
        }
    })?;
    let status = res.status().as_u16();
    let headers = sync::response_headers(res.headers());
    let bytes = sync::read_capped(res, sync::MAX_BODY).await?;
    Ok(SyncResponse {
        status,
        headers,
        body_base64: B64.encode(&bytes),
    })
}

/// Keep the sync key (base64) in the system keychain, or in a private file when there is none.
/// Says where it went: "keychain" or "file".
#[tauri::command]
async fn sync_key_save(key: String, state: tauri::State<'_, State>) -> Result<keys::Kept, String> {
    let file = state.key_file.clone();
    tauri::async_runtime::spawn_blocking(move || keys::save(&key, &file))
        .await
        .map_err(|e| e.to_string())?
}

/// The kept sync key (base64), or None.
#[tauri::command]
async fn sync_key_load(state: tauri::State<'_, State>) -> Result<Option<String>, String> {
    let file = state.key_file.clone();
    tauri::async_runtime::spawn_blocking(move || keys::load(&file))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn sync_key_forget(state: tauri::State<'_, State>) -> Result<(), String> {
    let file = state.key_file.clone();
    tauri::async_runtime::spawn_blocking(move || keys::forget(&file))
        .await
        .map_err(|e| e.to_string())?
}

/// Where a move to `dir` puts the file; refuses to overwrite another database.
fn move_target(current: &Path, dir: &Path) -> Result<PathBuf, String> {
    let target = dir.join(db::DB_FILE);
    if target == current {
        return Err("Vuurtoren's data is already in this folder.".into());
    }
    if target.exists() {
        return Err(format!(
            "There is already a {} in {}. Choose another folder, or move that file away first.",
            db::DB_FILE,
            dir.display()
        ));
    }
    Ok(target)
}

// ------------------------------------------------------------------ language server

/// Start the bundled language server unless it runs (or is starting) already.
fn ensure_sidecar(app: &AppHandle) {
    let state = app.state::<State>();
    let sc = &state.sidecar;
    {
        let mut current = sc.state.lock().unwrap();
        if !matches!(*current, sidecar::NlpState::Idle) {
            return;
        }
        *current = sidecar::NlpState::Starting;
    }
    // Development: an NLP server you run yourself (`pnpm nlp`).
    if let Ok(url) = std::env::var("VUURTOREN_NLP_URL") {
        *sc.base.lock().unwrap() = Some(url.trim_end_matches('/').to_string());
    } else {
        let resources = app.path().resource_dir().ok();
        let Some(exe) = sidecar::locate(resources.as_deref()) else {
            sc.set_state(sidecar::NlpState::Missing);
            return;
        };
        let (Ok(data), Ok(cache)) = (app.path().app_data_dir(), app.path().app_cache_dir()) else {
            sc.set_state(sidecar::NlpState::Failed {
                error: "No app data folder.".into(),
            });
            return;
        };
        let port = match sidecar::free_port() {
            Ok(p) => p,
            Err(e) => {
                sc.set_state(sidecar::NlpState::Failed {
                    error: format!("No free port: {e}"),
                });
                return;
            }
        };
        let packs = sidecar::bundled_packs(resources.as_deref());
        let launch = sidecar::Launch {
            exe: &exe,
            port,
            token: &sc.token,
            data_dir: &data.join("nlp-data"),
            cache_dir: &cache,
            packs_dir: packs.as_deref(),
        };
        if sc.spawn(&launch, &cache.join("vuurtoren-nlp.log")).is_err() {
            return;
        }
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<State>();
        if state
            .sidecar
            .wait_ready(&state.client, sidecar::START_TIMEOUT)
            .await
            != sidecar::NlpState::Ready
        {
            return;
        }
        // Keep the pack progress fresh while packs install (the proxy and the first-run card
        // read it).
        loop {
            tokio::time::sleep(Duration::from_millis(1500)).await;
            let Some(h) = state.sidecar.fetch_health(&state.client).await else {
                continue;
            };
            let busy = h.pointer("/packs/busy").and_then(Json::as_bool) == Some(true);
            *state.sidecar.health.lock().unwrap() = Some(h);
            if !busy {
                return;
            }
        }
    });
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NlpStatus {
    #[serde(flatten)]
    state: sidecar::NlpState,
    /// The language server's `/health` (data packs, OCR), once it answers.
    health: Option<Json>,
}

#[tauri::command]
async fn nlp_status(app: AppHandle, state: tauri::State<'_, State>) -> Result<NlpStatus, String> {
    ensure_sidecar(&app);
    let current = state.sidecar.state();
    if current == sidecar::NlpState::Ready {
        if let Some(h) = state.sidecar.fetch_health(&state.client).await {
            *state.sidecar.health.lock().unwrap() = Some(h);
        }
    }
    Ok(NlpStatus {
        state: current,
        health: state.sidecar.health.lock().unwrap().clone(),
    })
}

/// Start the language server again (after it failed).
#[tauri::command]
async fn nlp_restart(app: AppHandle, state: tauri::State<'_, State>) -> Result<(), String> {
    state.sidecar.stop();
    state.sidecar.set_state(sidecar::NlpState::Idle);
    ensure_sidecar(&app);
    Ok(())
}

/// Retry the data packs (e.g. after a failed download).
#[tauri::command]
async fn nlp_retry_packs(state: tauri::State<'_, State>) -> Result<(), String> {
    let base = state
        .sidecar
        .base()
        .ok_or("The language server is not running.")?;
    state
        .client
        .post(format!("{base}/admin/packs"))
        .header(sidecar::TOKEN_HEADER, &state.sidecar.token)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Look for an update once per start; ask before installing (the app restarts afterwards).
async fn check_for_update(app: AppHandle) {
    let configured = app
        .state::<State>()
        .config
        .lock()
        .unwrap()
        .update_url
        .clone();
    let Some(feed) = configured
        .or(BUILD_UPDATE_URL.map(String::from))
        .filter(|u| !u.is_empty())
    else {
        return;
    };
    let Ok(feed) = Url::parse(&feed) else { return };
    let Ok(builder) = app.updater_builder().endpoints(vec![feed]) else {
        return;
    };
    let Ok(updater) = builder.build() else { return };
    let update = match updater.check().await {
        Ok(Some(update)) => update,
        Ok(None) => return,
        Err(e) => {
            eprintln!("update check failed: {e}");
            return;
        }
    };
    let install = app
        .dialog()
        .message(format!(
            "Vuurtoren {} is available (you have {}). Install it now? Vuurtoren restarts afterwards.",
            update.version, update.current_version
        ))
        .title("Update available")
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Install".into(),
            "Later".into(),
        ))
        .blocking_show();
    if !install {
        return;
    }
    match update.download_and_install(|_, _| {}, || {}).await {
        Ok(()) => app.restart(),
        Err(e) => {
            app.dialog()
                .message(format!("The update could not be installed: {e}"))
                .title("Update failed")
                .blocking_show();
        }
    }
}

/// The home page's origin as pages report it (`tauri://localhost`, `http://tauri.localhost`, or
/// the dev server). Not `Url::origin()`: it is opaque ("null") for custom schemes.
fn home_origin(app: &AppHandle) -> String {
    let url = home_url(app);
    match url.port() {
        Some(port) => format!(
            "{}://{}:{port}",
            url.scheme(),
            url.host_str().unwrap_or_default()
        ),
        None => format!("{}://{}", url.scheme(), url.host_str().unwrap_or_default()),
    }
}

fn bridge_script(app: &AppHandle) -> String {
    include_str!("bridge.js").replace(
        "\"__HOME_ORIGIN__\"",
        &serde_json::to_string(&home_origin(app)).expect("string"),
    )
}

fn open_external(url: &Url) {
    if matches!(url.scheme(), "http" | "https" | "mailto") {
        let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // reqwest and the updater share rustls with the ring provider.
    let _ = rustls::crypto::ring::default_provider().install_default();

    tauri::Builder::default()
        // Must be first: a second launch focuses the running window instead.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window(MAIN) {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == MAIN {
                    on_close_requested(window, api);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            desktop_info,
            close_now,
            anki_fetch,
            sync_pick_folder,
            sync_dir_list,
            sync_dir_get,
            sync_dir_put,
            sync_dir_remove,
            sync_fetch,
            sync_allow_host,
            sync_key_save,
            sync_key_load,
            sync_key_forget,
            db_open,
            db_exec,
            db_close,
            db_export,
            db_import,
            db_reveal,
            db_move,
            nlp_status,
            nlp_restart,
            nlp_retry_packs,
            self_test_report
        ])
        .register_asynchronous_uri_scheme_protocol(proxy::SCHEME, |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                responder.respond(proxy::handle(app, request).await);
            });
        })
        .setup(|app| {
            let handle = app.handle().clone();
            let path = app.path().app_config_dir()?.join("desktop.json");
            let config: Config = std::fs::read(&path)
                .ok()
                .and_then(|b| serde_json::from_slice(&b).ok())
                .unwrap_or_default();
            let client = reqwest::Client::builder()
                .user_agent(concat!("Vuurtoren-Desktop/", env!("CARGO_PKG_VERSION")))
                .build()?;
            let sync_client = reqwest::Client::builder()
                .user_agent(concat!("Vuurtoren-Desktop/", env!("CARGO_PKG_VERSION")))
                .redirect(sync::redirect_policy())
                .build()?;
            let key_file = app.path().app_data_dir()?.join(keys::KEY_FILE);
            let documents = app
                .path()
                .document_dir()
                .or_else(|_| app.path().home_dir().map(|h| h.join("Documents")))?;
            // `--self-test`: start hidden, check the offline app end to end, exit.
            let self_test = std::env::args().any(|a| a == "--self-test");
            app.manage(State {
                config: Mutex::new(config),
                path,
                client,
                sync_client,
                sync_declined: Mutex::new(Vec::new()),
                key_file,
                db: Mutex::new(None),
                sidecar: sidecar::Sidecar::default(),
                default_db: db::default_path(&documents),
                closing: AtomicBool::new(false),
            });
            // Start the language server right away; the window does not wait for it.
            ensure_sidecar(&handle);

            let downloads = app.path().download_dir().ok();
            WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()))
                .title("Vuurtoren")
                .inner_size(1200.0, 820.0)
                .min_inner_size(380.0, 520.0)
                .visible(!self_test)
                .initialization_script(bridge_script(&handle))
                // Links that open a new tab (dictionary sites, docs) go to the system browser.
                .on_new_window(|url, _| {
                    open_external(&url);
                    NewWindowResponse::Deny
                })
                // Backups and exports land in the Downloads folder.
                .on_download(move |_, event| {
                    if let (DownloadEvent::Requested { destination, .. }, Some(dir)) =
                        (event, downloads.as_ref())
                    {
                        let name = destination
                            .file_name()
                            .map(|n| n.to_os_string())
                            .unwrap_or_else(|| "vuurtoren-download".into());
                        *destination = dir.join(name);
                    }
                    true
                })
                .build()?;

            if self_test {
                tauri::async_runtime::spawn(self_test_run(handle));
            } else {
                tauri::async_runtime::spawn(check_for_update(handle.clone()));
                tauri::async_runtime::spawn(heartbeat(handle));
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Vuurtoren")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                // Stop the language server and give the database file back.
                let state = app.state::<State>();
                state.sidecar.stop();
                close_db(&state);
            }
        });
}

/// Refresh the lock file's "last seen" every minute, so another computer can tell how recently
/// this one used the file.
async fn heartbeat(app: AppHandle) {
    loop {
        tokio::time::sleep(Duration::from_secs(60)).await;
        let state = app.state::<State>();
        let guard = state.db.lock().unwrap();
        if let Some(open) = guard.as_ref() {
            let mut me = open.me.clone();
            me.seen = db::now();
            if db::read_lock(&open.path).is_some_and(|l| l.host == me.host && l.pid == me.pid) {
                db::write_lock(&open.path, &me);
            }
        }
    }
}

/// What the page reported in `--self-test` mode.
static SELF_TEST_PAGE: Mutex<Option<String>> = Mutex::new(None);

/// The page's answer in `--self-test` mode (ignored otherwise).
#[tauri::command]
fn self_test_report(report: String) {
    if std::env::args().any(|a| a == "--self-test") {
        *SELF_TEST_PAGE.lock().unwrap() = Some(report);
    }
}

/// `vuurtoren --self-test`: start with a hidden window, wait for the language server and its data
/// packs, analyse a sentence through the page's own `/nlp` route (the `vuurtoren-nlp:` protocol)
/// and check the database file, then print one JSON line and exit (0 = all good).
async fn self_test_run(app: AppHandle) {
    let state = app.state::<State>();
    let started = std::time::Instant::now();
    let deadline = Duration::from_secs(900);
    let mut report = serde_json::json!({});
    // Wait for the sidecar and the packs (first start downloads them).
    let packs_ready = loop {
        if started.elapsed() > deadline {
            break false;
        }
        match state.sidecar.state() {
            sidecar::NlpState::Failed { error } => {
                report["error"] = error.into();
                break false;
            }
            sidecar::NlpState::Missing => {
                report["error"] = "no sidecar in this build".into();
                break false;
            }
            sidecar::NlpState::Ready => {
                if let Some(h) = state.sidecar.fetch_health(&state.client).await {
                    let busy = h.pointer("/packs/busy").and_then(Json::as_bool) == Some(true);
                    if !busy {
                        report["health"] = h;
                        break true;
                    }
                }
            }
            _ => {}
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    };
    report["sidecarSeconds"] = started.elapsed().as_secs().into();
    let mut ok = packs_ready;
    if packs_ready {
        let window = app.get_webview_window(MAIN).expect("main window");
        let script = r#"(async () => {
          const out = {};
          try {
            const r = await fetch("/nlp/analyze/text", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ texts: ["De kinderen liepen gisteren naar school."], lang: "nl" }),
            });
            const j = await r.json();
            out.status = r.status;
            out.lemma = j[0] && j[0].tokens[1] && j[0].tokens[1].lemma;
          } catch (e) { out.error = String(e); }
          window.__TAURI_INTERNALS__.invoke("self_test_report", { report: JSON.stringify(out) });
        })();"#;
        let mut page: Option<Json> = None;
        for i in 0..120 {
            tokio::time::sleep(Duration::from_millis(500)).await;
            // The web app needs a moment to boot (and to install its `/nlp` route): try every 5 s.
            if i % 10 == 0 {
                let _ = window.eval(script);
            }
            if let Some(json) = SELF_TEST_PAGE.lock().unwrap().take() {
                page = serde_json::from_str::<Json>(&json).ok();
                if page.as_ref().and_then(|p| p.get("status")).is_some() {
                    break;
                }
            }
        }
        let lemma_ok = page
            .as_ref()
            .and_then(|p| p.get("lemma"))
            .and_then(Json::as_str)
            == Some("kind");
        report["page"] = page.unwrap_or(Json::Null);
        ok &= lemma_ok;
    }
    let file = db_path(&state);
    report["database"] = file.to_string_lossy().to_string().into();
    report["databaseExists"] = file.is_file().into();
    report["lockExists"] = db::lock_path(&file).is_file().into();
    ok &= file.is_file();
    report["ok"] = ok.into();
    println!("{report}");
    app.exit(if ok { 0 } else { 1 });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn moving_never_overwrites_another_database() {
        let dir = tempfile::tempdir().unwrap();
        let current = dir.path().join("a").join(db::DB_FILE);
        let free = dir.path().join("b");
        std::fs::create_dir_all(&free).unwrap();
        assert_eq!(
            move_target(&current, &free).unwrap(),
            free.join(db::DB_FILE)
        );
        assert!(move_target(&current, current.parent().unwrap())
            .unwrap_err()
            .contains("already in this folder"));
        std::fs::write(free.join(db::DB_FILE), b"x").unwrap();
        assert!(move_target(&current, &free)
            .unwrap_err()
            .contains("already a vuurtoren.sqlite"));
    }

    #[test]
    fn anki_bridge_only_reaches_local_ankiconnect() {
        let ok = |s: &str| is_anki_url(&Url::parse(s).unwrap());
        assert!(ok("http://127.0.0.1:8765"));
        assert!(ok("http://localhost:8765/"));
        assert!(!ok("http://127.0.0.1:8766"));
        assert!(!ok("https://127.0.0.1:8765"));
        assert!(!ok("http://example.com:8765"));
        assert!(!ok("http://127.0.0.1.example.com:8765"));
    }
}
