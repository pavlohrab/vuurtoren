//! Vuurtoren: the whole app on this device, on a computer (Windows, macOS, Linux) or an Android
//! phone.
//!
//! The window shows the bundled web build (the "home" page). Its data is one SQLite file
//! (`db.rs`): on a computer in a visible folder (`~/Documents/Vuurtoren/vuurtoren.sqlite`), on a
//! phone in the app's private storage. Other devices come together with it through sync
//! (`sync.rs`); the sync key is kept by the device's key store (`keys.rs`).
//!
//! What only a computer has lives in `desktop.rs`: the bundled language server (`sidecar.rs`,
//! reached through the `vuurtoren-nlp:` protocol in `proxy.rs`), AnkiConnect, sync folders,
//! updates and the window's close request. What only a phone has lives in `mobile.rs`: the QR
//! scanner, `vuurtoren://` links and the Android Keystore.
//!
//! The page gets `window.__VUURTOREN_DESKTOP__` (see `bridge.js`; the name is kept on phones):
//! the database, sync and, on a computer, AnkiConnect and the language server.

mod audio;
mod db;
#[cfg(desktop)]
mod desktop;
mod dictionary;
mod keys;
mod lan;
#[cfg(desktop)]
mod lan_cmd;
#[cfg(desktop)]
mod lan_server;
#[cfg(mobile)]
mod mobile;
mod pinned;
#[cfg(desktop)]
mod proxy;
#[cfg(desktop)]
mod sidecar;
mod sync;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value as Json;
use tauri::ipc::InvokeBody;
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

const MAIN: &str = "main";

/// What the app remembers between starts (`<config dir>/desktop.json`).
#[derive(Default, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(mobile, allow(dead_code))]
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
    /// AnkiConnect and the bundled language server; the dictionary pack's download (phones).
    client: reqwest::Client,
    /// For sync places: redirects only within the same address (`sync::redirect_policy`).
    sync_client: reqwest::Client,
    /// Sync addresses the user declined since the app started (not asked again until restart).
    sync_declined: Mutex<Vec<String>>,
    /// Where the sync key is kept (`keys.rs`).
    keys: Arc<dyn keys::KeyStore>,
    db: Mutex<Option<OpenDb>>,
    #[cfg(desktop)]
    sidecar: sidecar::Sidecar,
    /// The default database file.
    default_db: PathBuf,
    /// The page finished its last sync (or took too long): the window may close.
    #[cfg(desktop)]
    closing: AtomicBool,
    /// `vuurtoren://` links that opened the app, until the page takes them (`links_take`).
    links: Mutex<Vec<String>>,
    /// The dictionary pack is downloading (phones), and its bytes on disk so far.
    dictionary_busy: AtomicBool,
    dictionary_received: AtomicU64,
    /// The same for the recordings pack (phones).
    audio_busy: AtomicBool,
    audio_received: AtomicU64,
}

impl State {
    #[cfg_attr(mobile, allow(dead_code))]
    fn save(&self, config: &Config) -> Result<(), String> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
        std::fs::write(&self.path, json).map_err(|e| e.to_string())
    }
}

/// The bundled web build's address (the dev server under `tauri dev`). Not `debug_assertions`:
/// a debug build (`tauri android build --debug`) serves the bundled page too, and taking the
/// dev server's address there left the page without its bridge (seen as a browser, so no
/// Connect step on a phone).
fn home_url(app: &AppHandle) -> Url {
    if tauri::is_dev() {
        if let Some(dev) = app.config().build.dev_url.clone() {
            return dev;
        }
    }
    let _ = app;
    let home = if cfg!(any(windows, target_os = "android")) {
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
    /// Base URL of the bundled language server (the `vuurtoren-nlp:` protocol); none on a phone.
    nlp_base: Option<&'static str>,
}

#[tauri::command]
fn desktop_info(app: AppHandle) -> DesktopInfo {
    DesktopInfo {
        version: app.package_info().version.to_string(),
        #[cfg(desktop)]
        nlp_base: Some(proxy::base_url()),
        #[cfg(mobile)]
        nlp_base: None,
    }
}

/// The `vuurtoren://` links that opened the app since the page last asked (oldest first).
#[tauri::command]
fn links_take(state: tauri::State<'_, State>) -> Vec<String> {
    std::mem::take(&mut *state.links.lock().unwrap())
}

/// Keep a `vuurtoren://` link for the page and tell it one arrived.
#[cfg_attr(desktop, allow(dead_code))]
fn link_arrived(app: &AppHandle, url: String) {
    if !url.starts_with("vuurtoren:") {
        return;
    }
    app.state::<State>().links.lock().unwrap().push(url);
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.eval("window.dispatchEvent(new Event('vuurtoren-link'))");
    }
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

/// The dictionary pack on this device (phones: `<app data>/packs/dictionary-nl.sqlite`): is it
/// there, and how large.
#[derive(Serialize)]
struct DictionaryStatus {
    installed: bool,
    bytes: u64,
    /// The size of the download (the archive this build wants).
    download: u64,
    /// Downloading now.
    downloading: bool,
    /// Bytes of the download on disk (while downloading, or left by one that stopped).
    received: u64,
}

#[tauri::command]
fn dictionary_status(app: AppHandle, state: tauri::State<'_, State>) -> DictionaryStatus {
    let downloading = state.dictionary_busy.load(Ordering::SeqCst);
    let wanted = dictionary::Pack::wanted();
    let received = if downloading {
        state.dictionary_received.load(Ordering::Relaxed)
    } else {
        match (app.path().app_data_dir(), &wanted) {
            (Ok(dir), Some(pack)) => {
                std::fs::metadata(dictionary::part_in(&dir, pack)).map_or(0, |m| m.len())
            }
            _ => 0,
        }
    };
    let path = app
        .path()
        .app_data_dir()
        .map(|d| dictionary::path_in(&d))
        .ok();
    let installed = path.as_deref().and_then(dictionary::open).is_some();
    let bytes = path
        .and_then(|p| std::fs::metadata(p).ok())
        .map_or(0, |m| m.len());
    DictionaryStatus {
        installed,
        bytes,
        download: wanted.map_or(0, |p| p.size),
        downloading,
        received,
    }
}

/// Meanings from the dictionary pack on this device, in the shape of the language server's
/// `/gloss`; `None` without the pack (the page then asks the server).
#[tauri::command]
async fn dictionary_gloss(
    words: Vec<String>,
    app: AppHandle,
) -> Result<Option<std::collections::HashMap<String, Vec<dictionary::Entry>>>, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(conn) = dictionary::open(&dictionary::path_in(&dir)) else {
            return Ok(None);
        };
        dictionary::lookup(&conn, &words)
            .map(Some)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Everything the word card shows about one word, from the dictionary pack on this device, in
/// the shape of the language server's `/entry`; `None` without the pack (the page then asks the
/// server).
#[tauri::command]
async fn dictionary_entry(
    word: String,
    pos: Option<String>,
    app: AppHandle,
) -> Result<Option<serde_json::Value>, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(conn) = dictionary::open(&dictionary::path_in(&dir)) else {
            return Ok(None);
        };
        dictionary::entry(&conn, &word, pos.as_deref())
            .map(Some)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The connected Vuurtoren server's language server and the device's sync token: the first
/// place to fetch the dictionary from.
#[derive(Deserialize)]
struct DictionaryFrom {
    /// `<server>/nlp`.
    nlp: String,
    token: String,
}

/// Download the dictionary pack (the version this build wants) and put it in place: from the data
/// host, else from the connected server (only an address the user allowed for sync). Resumes an unfinished download; `dictionary_status` reports the bytes
/// so far. Says where it came from ("server" or "release").
#[tauri::command]
async fn dictionary_install(
    from: Option<DictionaryFrom>,
    app: AppHandle,
    state: tauri::State<'_, State>,
) -> Result<&'static str, String> {
    let pack = dictionary::Pack::wanted().ok_or("This build names no dictionary pack.")?;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    // The data host first: Cloudflare keeps a copy close by, so it is fast. The connected server
    // only when that fails (a home server sends it through the home upload, much slower).
    let mut sources = vec![dictionary::Source {
        url: pack.url(),
        token: None,
        name: "release",
    }];
    if let Some(from) = from {
        let allowed = Url::parse(&from.nlp).is_ok_and(|u| {
            state
                .config
                .lock()
                .unwrap()
                .sync_hosts
                .contains(&sync::origin(&u))
        });
        if allowed {
            sources.push(dictionary::Source {
                url: pack.server_url(&from.nlp),
                token: Some(from.token),
                name: "server",
            });
        }
    }
    if state.dictionary_busy.swap(true, Ordering::SeqCst) {
        return Err("The dictionary is downloading already.".into());
    }
    let res = dictionary::download(
        &state.client,
        &sources,
        &pack,
        &dir,
        &state.dictionary_received,
    )
    .await;
    state.dictionary_busy.store(false, Ordering::SeqCst);
    res
}

/// The recordings pack on this device (phones: `<app data>/packs/audio-nl/`).
#[derive(Serialize)]
struct AudioStatus {
    installed: bool,
    bytes: u64,
    download: u64,
    downloading: bool,
    received: u64,
}

#[tauri::command]
fn audio_status(app: AppHandle, state: tauri::State<'_, State>) -> AudioStatus {
    let downloading = state.audio_busy.load(Ordering::SeqCst);
    let wanted = audio::Pack::wanted();
    let dir = app.path().app_data_dir().ok();
    let received = if downloading {
        state.audio_received.load(Ordering::Relaxed)
    } else {
        match (&dir, &wanted) {
            (Some(dir), Some(pack)) => {
                std::fs::metadata(audio::part_in(dir, pack)).map_or(0, |m| m.len())
            }
            _ => 0,
        }
    };
    let installed = !downloading && dir.as_deref().and_then(audio::installed).is_some();
    AudioStatus {
        installed,
        bytes: if installed {
            dir.as_deref().map_or(0, audio::bytes)
        } else {
            0
        },
        download: wanted.map_or(0, |p| p.size),
        downloading,
        received,
    }
}

/// A recorded clip from the pack on this device, as raw bytes (an mp3); empty without it.
#[tauri::command]
async fn audio_clip(
    voice: String,
    id: String,
    app: AppHandle,
) -> Result<tauri::ipc::Response, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let bytes = tauri::async_runtime::spawn_blocking(move || audio::clip(&dir, &voice, &id))
        .await
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    Ok(tauri::ipc::Response::new(bytes))
}

/// Download the recordings pack and unpack it: from the data host, else from the connected server
/// (an address allowed for sync). Resumes; says where it came from.
#[tauri::command]
async fn audio_install(
    from: Option<DictionaryFrom>,
    app: AppHandle,
    state: tauri::State<'_, State>,
) -> Result<&'static str, String> {
    let pack = audio::Pack::wanted().ok_or("This build names no recordings pack.")?;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    // The data host first: Cloudflare keeps a copy close by, so it is fast. The connected server
    // only when that fails (a home server sends it through the home upload, much slower).
    let mut sources = vec![dictionary::Source {
        url: pack.url(),
        token: None,
        name: "release",
    }];
    if let Some(from) = from {
        let allowed = Url::parse(&from.nlp).is_ok_and(|u| {
            state
                .config
                .lock()
                .unwrap()
                .sync_hosts
                .contains(&sync::origin(&u))
        });
        if allowed {
            sources.push(dictionary::Source {
                url: pack.server_url(&from.nlp),
                token: Some(from.token),
                name: "server",
            });
        }
    }
    if state.audio_busy.swap(true, Ordering::SeqCst) {
        return Err("The recordings are downloading already.".into());
    }
    let res = audio::download(&state.client, &sources, &pack, &dir, &state.audio_received).await;
    state.audio_busy.store(false, Ordering::SeqCst);
    res
}

/// Remove the recordings from this device (the phone voice speaks instead).
#[tauri::command]
fn audio_remove(app: AppHandle, state: tauri::State<'_, State>) -> Result<(), String> {
    if state.audio_busy.load(Ordering::SeqCst) {
        return Err("The recordings are downloading: wait until it is done.".into());
    }
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    audio::remove(&dir);
    Ok(())
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

// ------------------------------------------------------------------ sync

pub(crate) const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncRequest {
    url: String,
    method: String,
    #[serde(default)]
    headers: std::collections::HashMap<String, String>,
    body_base64: Option<String>,
    /// "Connect a phone": the SHA-256 of the computer's certificate from the QR code; the
    /// request then trusts exactly that certificate (`pinned.rs`) instead of the usual roots.
    #[serde(default)]
    pinned: Option<String>,
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
    let client = match req.pinned.as_deref() {
        Some(sha256) => pinned::client(sha256)?,
        None => state.sync_client.clone(),
    };
    let mut builder = client
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

/// Keep a secret in the device's key store (`keys.rs`): the sync key (base64, `name` absent or
/// "sync-key") or a server's sync token ("sync-token"). Says where it went: "keychain" or "file"
/// on a computer, "keystore" on Android.
#[tauri::command]
async fn sync_key_save(
    key: String,
    name: Option<String>,
    state: tauri::State<'_, State>,
) -> Result<keys::Kept, String> {
    let store = state.keys.clone();
    let name = keys::entry(name.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || store.save(name, &key))
        .await
        .map_err(|e| e.to_string())?
}

/// The kept secret, or None.
#[tauri::command]
async fn sync_key_load(
    name: Option<String>,
    state: tauri::State<'_, State>,
) -> Result<Option<String>, String> {
    let store = state.keys.clone();
    let name = keys::entry(name.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || store.load(name))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn sync_key_forget(
    name: Option<String>,
    state: tauri::State<'_, State>,
) -> Result<(), String> {
    let store = state.keys.clone();
    let name = keys::entry(name.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || store.forget(name))
        .await
        .map_err(|e| e.to_string())?
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
    include_str!("bridge.js")
        .replace(
            "\"__HOME_ORIGIN__\"",
            &serde_json::to_string(&home_origin(app)).expect("string"),
        )
        .replace(
            "\"__OS__\"",
            &serde_json::to_string(std::env::consts::OS).expect("string"),
        )
}

fn open_external(url: &Url) {
    if matches!(url.scheme(), "http" | "https" | "mailto") {
        let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
    }
}

/// The user agent of the app's own requests.
const USER_AGENT: &str = if cfg!(target_os = "android") {
    concat!("Vuurtoren-Android/", env!("CARGO_PKG_VERSION"))
} else {
    concat!("Vuurtoren-Desktop/", env!("CARGO_PKG_VERSION"))
};

/**
 * Every HTTP client of the app starts here. On a phone, https is checked against Mozilla's
 * root certificates (webpki-root-certs) instead of the system's: reqwest's default system check
 * needs a Java-side setup on Android and aborts the app on the first https request without it
 * (the dictionary download, sync).
 */
pub(crate) fn http_builder() -> reqwest::ClientBuilder {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let builder = reqwest::Client::builder();
    #[cfg(mobile)]
    let builder = builder.tls_certs_only(
        webpki_root_certs::TLS_SERVER_ROOT_CERTS
            .iter()
            .filter_map(|der| reqwest::Certificate::from_der(der).ok()),
    );
    builder
}

/// Where the sync key is kept on this device.
#[cfg(desktop)]
fn key_store(app: &tauri::App) -> tauri::Result<Arc<dyn keys::KeyStore>> {
    Ok(Arc::new(keys::SystemKeys::new(app.path().app_data_dir()?)))
}

#[cfg(mobile)]
fn key_store(app: &tauri::App) -> tauri::Result<Arc<dyn keys::KeyStore>> {
    mobile::key_store(app)
}

/// The folder the database goes into by default: Documents on a computer (visible, so it can be
/// backed up and moved), the app's private storage on a phone.
fn data_home(app: &tauri::App) -> tauri::Result<PathBuf> {
    #[cfg(desktop)]
    return app
        .path()
        .document_dir()
        .or_else(|_| app.path().home_dir().map(|h| h.join("Documents")));
    #[cfg(mobile)]
    return app.path().app_data_dir();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // reqwest and the updater share rustls with the ring provider.
    let _ = rustls::crypto::ring::default_provider().install_default();

    let builder = tauri::Builder::default();
    // Desktop: must come first (a second launch focuses the running window instead).
    #[cfg(desktop)]
    let builder = desktop::plugins(builder);
    #[cfg(mobile)]
    let builder = mobile::plugins(builder);
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            desktop_info,
            links_take,
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
            dictionary_status,
            dictionary_gloss,
            dictionary_entry,
            dictionary_install,
            audio_status,
            audio_clip,
            audio_install,
            audio_remove,
            #[cfg(desktop)]
            desktop::close_now,
            #[cfg(desktop)]
            desktop::anki_fetch,
            #[cfg(desktop)]
            desktop::sync_pick_folder,
            #[cfg(desktop)]
            desktop::sync_dir_list,
            #[cfg(desktop)]
            desktop::sync_dir_get,
            #[cfg(desktop)]
            desktop::sync_dir_put,
            #[cfg(desktop)]
            desktop::sync_dir_remove,
            #[cfg(desktop)]
            desktop::db_reveal,
            #[cfg(desktop)]
            desktop::db_move,
            #[cfg(desktop)]
            desktop::nlp_status,
            #[cfg(desktop)]
            desktop::nlp_restart,
            #[cfg(desktop)]
            desktop::nlp_retry_packs,
            #[cfg(desktop)]
            desktop::self_test_report,
            #[cfg(desktop)]
            lan_cmd::lan_start,
            #[cfg(desktop)]
            lan_cmd::lan_code,
            #[cfg(desktop)]
            lan_cmd::lan_phones,
            #[cfg(desktop)]
            lan_cmd::lan_remove,
            #[cfg(desktop)]
            lan_cmd::lan_firewall,
            #[cfg(desktop)]
            lan_cmd::lan_firewall_allow,
            #[cfg(mobile)]
            mobile::app_exit
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let path = app.path().app_config_dir()?.join("desktop.json");
            let config: Config = std::fs::read(&path)
                .ok()
                .and_then(|b| serde_json::from_slice(&b).ok())
                .unwrap_or_default();
            let sync_client = http_builder()
                .user_agent(USER_AGENT)
                .redirect(sync::redirect_policy())
                .build()?;
            let keys = key_store(app)?;
            let home = data_home(app)?;
            app.manage(State {
                config: Mutex::new(config),
                path,
                client: http_builder().user_agent(USER_AGENT).build()?,
                sync_client,
                sync_declined: Mutex::new(Vec::new()),
                keys,
                db: Mutex::new(None),
                #[cfg(desktop)]
                sidecar: sidecar::Sidecar::default(),
                default_db: db::default_path(&home),
                #[cfg(desktop)]
                closing: AtomicBool::new(false),
                links: Mutex::new(Vec::new()),
                dictionary_busy: AtomicBool::new(false),
                dictionary_received: AtomicU64::new(0),
                audio_busy: AtomicBool::new(false),
                audio_received: AtomicU64::new(0),
            });
            #[cfg(desktop)]
            desktop::before_window(&handle);
            // Connected phones sync with this computer from the start (SY1).
            #[cfg(desktop)]
            lan_cmd::resume(&handle);

            let window = WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()))
                .initialization_script(bridge_script(&handle))
                // Links that open a new tab (dictionary sites, docs) go to the system browser.
                .on_new_window(|url, _| {
                    open_external(&url);
                    NewWindowResponse::Deny
                });
            #[cfg(desktop)]
            let window = desktop::window(window, app);
            window.build()?;

            #[cfg(desktop)]
            desktop::after_window(handle);
            #[cfg(mobile)]
            mobile::after_window(&handle);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Vuurtoren")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                // Stop the language server and give the database file back.
                let state = app.state::<State>();
                #[cfg(desktop)]
                state.sidecar.stop();
                close_db(&state);
            }
        });
}
