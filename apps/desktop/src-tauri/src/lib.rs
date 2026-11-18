//! Kenning desktop (D2/D3): a thin client around the user's Kenning server.
//!
//! The window starts on the bundled web build (the "home" page). On first start it shows the
//! Connect screen; once a server is chosen the window navigates to that server, so the page,
//! its cookies, CSP and CSRF checks are exactly those of the server in a browser (see
//! docs/desktop.md, "Why the window loads the server"). The only native help the server page
//! gets is `window.__KENNING_DESKTOP__` (see `bridge.js`): AnkiConnect requests sent from Rust
//! (no webCorsOriginList setup) and "change server". D4 (offline) will stay on the home page
//! and use a local database and NLP sidecar instead of navigating away.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::ipc::CapabilityBuilder;
use tauri::webview::{DownloadEvent, NewWindowResponse};
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_updater::UpdaterExt;

const MAIN: &str = "main";
/// The only addresses the Anki bridge may reach (AnkiConnect's default port, this machine).
const ANKI_HOSTS: [&str; 2] = ["127.0.0.1", "localhost"];
const ANKI_PORT: u16 = 8765;
/// Update feed: the `latest.json` of the newest GitHub release (public repo). CI may override it
/// at build time with the `KENNING_UPDATE_URL` repository variable.
const DEFAULT_UPDATE_URL: &str =
    "https://github.com/pavlohrab/Kenning/releases/latest/download/latest.json";
const BUILD_UPDATE_URL: Option<&str> = match option_env!("KENNING_UPDATE_URL") {
    Some(url) if !url.is_empty() => Some(url),
    _ => Some(DEFAULT_UPDATE_URL),
};

/// What the app remembers between starts (`<config dir>/desktop.json`).
#[derive(Default, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
struct Config {
    /// The Kenning server this app opens, as an origin with a trailing slash.
    server_url: Option<String>,
    /// Overrides the update feed (a `latest.json` URL); empty string turns updates off.
    update_url: Option<String>,
}

struct State {
    config: Mutex<Config>,
    path: PathBuf,
    client: reqwest::Client,
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

/// `https://host:port/` from whatever the user typed (scheme optional, path dropped).
fn normalize_server(input: &str) -> Result<Url, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Enter the address of your Kenning server.".into());
    }
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let url =
        Url::parse(&with_scheme).map_err(|_| format!("\"{trimmed}\" is not a web address."))?;
    if url.scheme() != "https" && url.scheme() != "http" {
        return Err("The address must start with https:// or http://.".into());
    }
    if url.host_str().is_none() {
        return Err(format!("\"{trimmed}\" is not a web address."));
    }
    let origin = url.origin().ascii_serialization();
    Url::parse(&format!("{origin}/")).map_err(|e| e.to_string())
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

/// Let pages from the chosen server use the bridge commands (and nothing else).
fn allow_server(app: &AppHandle, server: &Url) -> Result<(), String> {
    let origin = server.origin().ascii_serialization();
    app.add_capability(
        CapabilityBuilder::new("server")
            .remote(format!("{origin}/*"))
            .local(false)
            .window(MAIN)
            .permission("allow-anki-fetch")
            .permission("allow-change-server")
            .permission("allow-desktop-info"),
    )
    .map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopInfo {
    version: String,
    server_url: Option<String>,
}

#[tauri::command]
fn desktop_info(app: AppHandle, state: tauri::State<'_, State>) -> DesktopInfo {
    DesktopInfo {
        version: app.package_info().version.to_string(),
        server_url: state.config.lock().unwrap().server_url.clone(),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerCheck {
    /// The normalized address (`https://host/`).
    url: String,
    /// The server's `/api/health` answer.
    health: serde_json::Value,
}

/// GET `<server>/api/health` from Rust (the home page may not fetch another origin).
#[tauri::command]
async fn check_server(url: String, state: tauri::State<'_, State>) -> Result<ServerCheck, String> {
    let server = normalize_server(&url)?;
    let health_url = server.join("api/health").map_err(|e| e.to_string())?;
    let host = server.host_str().unwrap_or_default().to_string();
    let res = state
        .client
        .get(health_url)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                format!("{host} did not answer in time.")
            } else {
                format!("Could not reach {host}. Check the address and your connection.")
            }
        })?;
    let status = res.status();
    let health: serde_json::Value = res.json().await.map_err(|_| {
        format!("{host} answered, but it is not a Kenning server (HTTP {status}).")
    })?;
    if health.get("schemaVersion").is_none() {
        return Err(format!("{host} answered, but it is not a Kenning server."));
    }
    Ok(ServerCheck {
        url: server.to_string(),
        health,
    })
}

/// Remember the server and open it in the window.
#[tauri::command]
fn connect(
    url: String,
    app: AppHandle,
    window: WebviewWindow,
    state: tauri::State<'_, State>,
) -> Result<(), String> {
    let server = normalize_server(&url)?;
    {
        let mut config = state.config.lock().unwrap();
        config.server_url = Some(server.to_string());
        state.save(&config)?;
    }
    allow_server(&app, &server)?;
    window.navigate(server).map_err(|e| e.to_string())
}

/// Back to the Connect screen (the saved server stays until another one is chosen).
#[tauri::command]
fn change_server(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    let mut home = home_url(&app);
    home.set_query(Some("connect"));
    window.navigate(home).map_err(|e| e.to_string())
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

/// Look for an update once per start; ask before installing (the app restarts afterwards).
async fn check_for_update(app: AppHandle) {
    let configured = app.state::<State>().config.lock().unwrap().update_url.clone();
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
            "Kenning {} is available (you have {}). Install it now? Kenning restarts afterwards.",
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

fn bridge_script(app: &AppHandle) -> String {
    // Not `Url::origin()`: it is opaque ("null") for custom schemes such as tauri://.
    let url = home_url(app);
    let home = match url.port() {
        Some(port) => format!("{}://{}:{port}", url.scheme(), url.host_str().unwrap_or_default()),
        None => format!("{}://{}", url.scheme(), url.host_str().unwrap_or_default()),
    };
    include_str!("bridge.js").replace(
        "\"__HOME_ORIGIN__\"",
        &serde_json::to_string(&home).expect("string"),
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
        .invoke_handler(tauri::generate_handler![
            desktop_info,
            check_server,
            connect,
            change_server,
            anki_fetch
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let path = app.path().app_config_dir()?.join("desktop.json");
            let config: Config = std::fs::read(&path)
                .ok()
                .and_then(|b| serde_json::from_slice(&b).ok())
                .unwrap_or_default();
            if let Some(server) = config
                .server_url
                .as_deref()
                .and_then(|s| normalize_server(s).ok())
            {
                allow_server(&handle, &server)?;
            }
            let client = reqwest::Client::builder()
                .user_agent(concat!("Kenning-Desktop/", env!("CARGO_PKG_VERSION")))
                .build()?;
            app.manage(State {
                config: Mutex::new(config),
                path,
                client,
            });

            let downloads = app.path().download_dir().ok();
            WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()))
                .title("Kenning")
                .inner_size(1200.0, 820.0)
                .min_inner_size(380.0, 520.0)
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
                            .unwrap_or_else(|| "kenning-download".into());
                        *destination = dir.join(name);
                    }
                    true
                })
                .build()?;

            tauri::async_runtime::spawn(check_for_update(handle));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Kenning");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn server_addresses_are_normalized_to_origins() {
        assert_eq!(
            normalize_server("kenning.example").unwrap().as_str(),
            "https://kenning.example/"
        );
        assert_eq!(
            normalize_server(" http://10.0.0.5:8080/library?x ")
                .unwrap()
                .as_str(),
            "http://10.0.0.5:8080/"
        );
        assert!(normalize_server("").is_err());
        assert!(normalize_server("ftp://x").is_err());
        assert!(normalize_server("file:///etc/passwd").is_err());
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
