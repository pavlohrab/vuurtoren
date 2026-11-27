//! What only a computer has: the bundled language server (`sidecar.rs`, reached through the
//! `vuurtoren-nlp:` protocol in `proxy.rs`), AnkiConnect, folders to sync through, the database
//! file shown and moved in the file manager, updates, one window that sends its last changes
//! before it closes, and `--self-test`.

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value as Json;
use tauri::webview::DownloadEvent;
use tauri::{AppHandle, Manager, Url, WebviewWindowBuilder, WindowEvent, Wry};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;

use crate::{db, db_path, proxy, sidecar, sync, with_db, State, B64, MAIN};

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
pub fn close_now(app: AppHandle) {
    close_window(&app);
}

#[derive(Deserialize)]
pub struct AnkiRequest {
    url: String,
    method: Option<String>,
    body: Option<String>,
    /// Milliseconds (default and cap: 5 minutes; the page aborts earlier with its own timeout).
    timeout: Option<u64>,
}

#[derive(Serialize)]
pub struct AnkiResponse {
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
pub async fn anki_fetch(
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

/// Show the database file in the system file manager.
#[tauri::command]
pub async fn db_reveal(app: AppHandle, state: tauri::State<'_, State>) -> Result<(), String> {
    let path = db_path(&state);
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| e.to_string())
}

/// Move the database to a folder the user picks: a consistent copy is written there, the app
/// switches to it, and the old file is left where it was. None when the user cancelled.
#[tauri::command]
pub async fn db_move(
    app: AppHandle,
    state: tauri::State<'_, State>,
) -> Result<Option<String>, String> {
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

/// Pick the folder to sync through (one Syncthing, Dropbox or iCloud Drive already syncs).
/// None when the user cancelled.
#[tauri::command]
pub async fn sync_pick_folder(
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
pub async fn sync_dir_list(
    root: String,
    dir: String,
    state: tauri::State<'_, State>,
) -> Result<Vec<String>, String> {
    sync::list(&sync_root(&state, &root)?, &dir)
}

/// A file of the sync folder as base64, or None when it does not exist.
#[tauri::command]
pub async fn sync_dir_get(
    root: String,
    path: String,
    state: tauri::State<'_, State>,
) -> Result<Option<String>, String> {
    use base64::Engine as _;
    Ok(sync::get(&sync_root(&state, &root)?, &path)?.map(|b| B64.encode(b)))
}

#[tauri::command]
pub async fn sync_dir_put(
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
pub async fn sync_dir_remove(
    root: String,
    path: String,
    state: tauri::State<'_, State>,
) -> Result<(), String> {
    sync::remove(&sync_root(&state, &root)?, &path)
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
pub fn ensure_sidecar(app: &AppHandle) {
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
pub struct NlpStatus {
    #[serde(flatten)]
    state: sidecar::NlpState,
    /// The language server's `/health` (data packs, OCR), once it answers.
    health: Option<Json>,
}

#[tauri::command]
pub async fn nlp_status(
    app: AppHandle,
    state: tauri::State<'_, State>,
) -> Result<NlpStatus, String> {
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
pub async fn nlp_restart(app: AppHandle, state: tauri::State<'_, State>) -> Result<(), String> {
    state.sidecar.stop();
    state.sidecar.set_state(sidecar::NlpState::Idle);
    ensure_sidecar(&app);
    Ok(())
}

/// Retry the data packs (e.g. after a failed download).
#[tauri::command]
pub async fn nlp_retry_packs(state: tauri::State<'_, State>) -> Result<(), String> {
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

/// What the page reported in `--self-test` mode.
static SELF_TEST_PAGE: Mutex<Option<String>> = Mutex::new(None);

/// The page's answer in `--self-test` mode (ignored otherwise).
#[tauri::command]
pub fn self_test_report(report: String) {
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

// ------------------------------------------------------------------ app

/// The computer's plugins, the window's close request and the language server's protocol.
pub fn plugins(builder: tauri::Builder<Wry>) -> tauri::Builder<Wry> {
    builder
        // Must be first: a second launch focuses the running window instead.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window(MAIN) {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == MAIN {
                    on_close_requested(window, api);
                }
            }
        })
        .register_asynchronous_uri_scheme_protocol(proxy::SCHEME, |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                responder.respond(proxy::handle(app, request).await);
            });
        })
}

/// `--self-test`: start hidden, check the offline app end to end, exit.
fn self_test() -> bool {
    std::env::args().any(|a| a == "--self-test")
}

/// Start the language server right away; the window does not wait for it.
pub fn before_window(app: &AppHandle) {
    ensure_sidecar(app);
}

/// The window on a computer: its size, hidden for the self-test, downloads to Downloads.
pub fn window<'a>(
    window: WebviewWindowBuilder<'a, Wry, tauri::App>,
    app: &tauri::App,
) -> WebviewWindowBuilder<'a, Wry, tauri::App> {
    let downloads = app.path().download_dir().ok();
    window
        .title("Vuurtoren")
        .inner_size(1200.0, 820.0)
        .min_inner_size(380.0, 520.0)
        // The start screen's sand from the first frame: the webview was white until the page
        // painted (a white flash before the logo).
        .background_color(tauri::window::Color(0xec, 0xe5, 0xd9, 0xff))
        .visible(!self_test())
        // Drags belong to the page (moving a text to a shelf, a file onto Add text): Tauri's own
        // file-drop handler took every drag, so the page never saw one.
        .disable_drag_drop_handler()
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
}

/// After the window opened: the self-test, or the update check and the lock's heartbeat.
pub fn after_window(app: AppHandle) {
    if self_test() {
        tauri::async_runtime::spawn(self_test_run(app));
    } else {
        tauri::async_runtime::spawn(check_for_update(app.clone()));
        tauri::async_runtime::spawn(heartbeat(app));
    }
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
