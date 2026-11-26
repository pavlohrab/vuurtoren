//! The app's commands for "Connect a phone" (SY1): start the computer's HTTPS listener, make a
//! pairing code (with the handover the phone gets), list and remove phones. Computers only.
//! Files in the app's data folder: `sync-place/` (the place when the computer has no other),
//! `lan-root` (the computer's own sync folder, when the phones use that one instead),
//! `lan-phones.json` (the phones, tokens as hashes), `lan-port` (the port, kept across starts),
//! `lan-cert.der` / `lan-key.der` (the certificate whose SHA-256 is in the QR code).

use std::net::UdpSocket;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::lan::Lan;
use crate::lan_server;

struct Hub {
    lan: Arc<Mutex<Lan>>,
    dir: PathBuf,
    on: Mutex<Option<(u16, String)>>,
}

static HUB: OnceLock<Hub> = OnceLock::new();

fn hub(app: &AppHandle) -> Result<&'static Hub, String> {
    if let Some(h) = HUB.get() {
        return Ok(h);
    }
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let place = dir.join("sync-place");
    std::fs::create_dir_all(&place).map_err(|e| e.to_string())?;
    // The folder chosen last time (the computer's own sync folder), while it is there.
    let root = std::fs::read_to_string(dir.join("lan-root"))
        .ok()
        .map(|p| PathBuf::from(p.trim()))
        .filter(|p| p.is_dir())
        .unwrap_or(place);
    let mut lan = Lan::new(&root);
    if let Ok(bytes) = std::fs::read(dir.join("lan-phones.json")) {
        if let Ok(v) = serde_json::from_slice(&bytes) {
            lan.load_phones(&v);
        }
    }
    lan.set_moved(dir.join(MOVED_FILE).is_file());
    let _ = HUB.set(Hub {
        lan: Arc::new(Mutex::new(lan)),
        dir,
        on: Mutex::new(None),
    });
    HUB.get().ok_or_else(|| "Could not start".to_string())
}

/// This computer's address on the home network (the route a packet to the internet would take;
/// nothing is sent). Empty when it has none.
fn local_addresses() -> Vec<String> {
    UdpSocket::bind("0.0.0.0:0")
        .and_then(|s| s.connect("192.0.2.1:9").map(|()| s))
        .and_then(|s| s.local_addr())
        .map(|a| a.ip())
        .ok()
        .filter(|ip| !ip.is_loopback() && !ip.is_unspecified())
        .map(|ip| vec![ip.to_string()])
        .unwrap_or_default()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanInfo {
    port: u16,
    fingerprint: String,
    addresses: Vec<String>,
    /// The folder that is the sync place when the computer has no other.
    place_dir: String,
}

/// The port phones connect to (lan_server falls back to a free one when it is taken).
pub const PHONE_PORT: u16 = 47120;

/// Start listening for phones (once; later calls say where it listens). `folder`: serve the
/// computer's own sync folder instead of `sync-place` (kept for the next start).
#[tauri::command]
pub async fn lan_start(app: AppHandle, folder: Option<String>) -> Result<LanInfo, String> {
    let hub = hub(&app)?;
    if let Some(folder) = folder {
        let path = PathBuf::from(&folder);
        if !path.is_dir() {
            return Err(format!("The sync folder {folder} is not there."));
        }
        hub.lan.lock().map_err(|e| e.to_string())?.set_root(&path);
        std::fs::write(hub.dir.join("lan-root"), &folder).map_err(|e| e.to_string())?;
    }
    let running = hub.on.lock().map_err(|e| e.to_string())?.clone();
    let (port, fingerprint) = match running {
        Some(on) => on,
        None => {
            let port_file = hub.dir.join("lan-port");
            // The port kept from last time, else the fixed one (47120): the same every time, so
            // a firewall rule for it keeps working. Taken by something else: any free port.
            let port = std::fs::read_to_string(&port_file)
                .ok()
                .and_then(|p| p.trim().parse().ok())
                .unwrap_or(PHONE_PORT);
            let (on, run) = lan_server::listen(
                hub.lan.clone(),
                &hub.dir,
                port,
                Some(hub.dir.join("lan-phones.json")),
            )
            .await?;
            tauri::async_runtime::spawn(run);
            let _ = std::fs::write(&port_file, on.port.to_string());
            let both = (on.port, on.fingerprint);
            *hub.on.lock().map_err(|e| e.to_string())? = Some(both.clone());
            both
        }
    };
    Ok(LanInfo {
        port,
        fingerprint,
        addresses: local_addresses(),
        place_dir: hub.dir.join("sync-place").to_string_lossy().into_owned(),
    })
}

/// At the app's start: listen again when phones are connected, so they sync without anyone
/// opening Settings.
pub fn resume(app: &AppHandle) {
    let Ok(hub) = hub(app) else { return };
    let phones = hub.lan.lock().map(|l| l.has_phones()).unwrap_or(false);
    if phones {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = lan_start(app, None).await;
        });
    }
}

/// A new pairing code; `handover` (the sync place and key) goes to the phone that uses it.
#[tauri::command]
pub fn lan_code(app: AppHandle, handover: Option<serde_json::Value>) -> Result<String, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let hub = hub(&app)?;
    let mut lan = hub.lan.lock().map_err(|e| e.to_string())?;
    // A new code: the computer shares its folder again (the page checked it syncs there).
    lan.set_moved(false);
    let _ = std::fs::remove_file(hub.dir.join(MOVED_FILE));
    Ok(lan.new_code_with(now, handover))
}

/// The phone that used the code and waits for "Is this your phone?" (SY12): `{id, name}`, or
/// null.
#[tauri::command]
pub fn lan_asking(app: AppHandle) -> Result<serde_json::Value, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let hub = hub(&app)?;
    let lan = hub.lan.lock().map_err(|e| e.to_string())?;
    Ok(lan.asking_json(now))
}

/// The computer's answer to "Is this your phone?" (SY12).
#[tauri::command]
pub fn lan_answer(app: AppHandle, id: String, yes: bool) -> Result<bool, String> {
    let hub = hub(&app)?;
    let mut lan = hub.lan.lock().map_err(|e| e.to_string())?;
    Ok(lan.answer(&id, yes))
}

/// Kept while this computer syncs through another place (SY5).
const MOVED_FILE: &str = "lan-moved";

/// The computer moved from its folder to a server or WebDAV, or stopped syncing (SY5): its
/// phones are told so (410) instead of syncing with a folder nobody updates. Remembered across
/// starts; a new code clears it.
#[tauri::command]
pub fn lan_moved(app: AppHandle) -> Result<(), String> {
    let hub = hub(&app)?;
    if !hub.lan.lock().map_err(|e| e.to_string())?.has_phones() {
        return Ok(());
    }
    hub.lan.lock().map_err(|e| e.to_string())?.set_moved(true);
    std::fs::write(hub.dir.join(MOVED_FILE), b"1").map_err(|e| e.to_string())
}

/// The phones connected to this computer.
#[tauri::command]
pub fn lan_phones(app: AppHandle) -> Result<serde_json::Value, String> {
    let hub = hub(&app)?;
    let lan = hub.lan.lock().map_err(|e| e.to_string())?;
    Ok(lan.phones_json())
}

/// Remove a phone: its token stops working at once.
#[tauri::command]
pub fn lan_remove(app: AppHandle, hash: String) -> Result<(), String> {
    let hub = hub(&app)?;
    let mut lan = hub.lan.lock().map_err(|e| e.to_string())?;
    lan.remove_phone(&hash);
    lan.take_dirty();
    std::fs::write(
        hub.dir.join("lan-phones.json"),
        lan.phones_json().to_string(),
    )
    .map_err(|e| e.to_string())
}

/// What the computer's firewall does to the phone port (SY9). firewalld (Fedora, openSUSE) can be
/// asked without admin rights; ufw (Ubuntu, Mint) only says that it runs, so `open` is None there.
/// Elsewhere `tool` is None and the app says nothing.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FirewallInfo {
    /// "firewalld" or "ufw" when it runs, else None.
    tool: Option<&'static str>,
    /// Whether the port is open in the active zone (None: couldn't tell).
    open: Option<bool>,
    /// The command that opens it, for people who'd rather type it.
    command: Option<String>,
}

fn ufw_command(port: u16) -> String {
    format!("sudo ufw allow {port}/tcp")
}

/// Is ufw on? `systemctl is-active ufw` says "active" even when ufw is switched off (it is a
/// oneshot service), so its own setting decides: `ENABLED=yes` in /etc/ufw/ufw.conf, which
/// anyone can read (ufw's status needs admin rights).
#[cfg(target_os = "linux")]
fn ufw_active() -> bool {
    std::fs::read_to_string("/etc/ufw/ufw.conf")
        .map(|conf| ufw_enabled(&conf))
        .unwrap_or(false)
}

/// `ENABLED=yes` in ufw.conf (quotes and spaces allowed, comments not).
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn ufw_enabled(conf: &str) -> bool {
    conf.lines().any(|l| {
        let l = l.trim();
        !l.starts_with('#')
            && l.split_once('=').is_some_and(|(k, v)| {
                k.trim() == "ENABLED"
                    && v.trim()
                        .trim_matches(|c| c == '"' || c == '\'')
                        .eq_ignore_ascii_case("yes")
            })
    })
}

fn firewalld_command(port: u16) -> String {
    format!("sudo firewall-cmd --permanent --add-port={port}/tcp && sudo firewall-cmd --reload")
}

/// Run `firewall-cmd` with a time limit: with D-Bus stuck it would wait 25 s for nothing.
/// Some(success) when it answered in time, None otherwise.
#[cfg(target_os = "linux")]
fn firewall_cmd(arg: &str) -> Option<bool> {
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};
    let mut child = Command::new("firewall-cmd")
        .arg(arg)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let until = Instant::now() + Duration::from_secs(3);
    loop {
        if let Ok(Some(status)) = child.try_wait() {
            return Some(status.success());
        }
        if Instant::now() >= until {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// Is the phone port open? Asks firewalld (no admin needed, at most a few seconds, off the
/// window's thread); other systems: unknown.
#[tauri::command]
pub async fn lan_firewall(port: u16) -> FirewallInfo {
    tauri::async_runtime::spawn_blocking(move || firewall_info(port))
        .await
        .unwrap_or(FirewallInfo {
            tool: None,
            open: None,
            command: None,
        })
}

fn firewall_info(port: u16) -> FirewallInfo {
    #[cfg(target_os = "linux")]
    {
        if firewall_cmd("--state") == Some(true) {
            return FirewallInfo {
                tool: Some("firewalld"),
                open: firewall_cmd(&format!("--query-port={port}/tcp")),
                command: Some(firewalld_command(port)),
            };
        }
        if ufw_active() {
            return FirewallInfo {
                tool: Some("ufw"),
                open: None,
                command: Some(ufw_command(port)),
            };
        }
    }
    let _ = port;
    FirewallInfo {
        tool: None,
        open: None,
        command: None,
    }
}

/// Open the phone port for good in firewalld or ufw: the system asks for the admin password
/// (pkexec), once.
#[tauri::command]
pub async fn lan_firewall_allow(port: u16) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || allow_firewall(port))
        .await
        .map_err(|e| e.to_string())?
}

fn allow_firewall(port: u16) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        // `port` is a number, so the line has nothing in it from outside.
        let line = if firewall_cmd("--state") == Some(true) {
            format!("firewall-cmd --permanent --add-port={port}/tcp && firewall-cmd --reload")
        } else if ufw_active() {
            format!("ufw allow {port}/tcp")
        } else {
            return Err("No firewall to open was found.".to_string());
        };
        let out = Command::new("pkexec")
            .args(["sh", "-c", &line])
            .output()
            .map_err(|e| format!("Could not ask for the admin password: {e}"))?;
        if out.status.success() {
            return Ok(());
        }
        // 126: the password dialog was closed; 127: not allowed.
        return Err(match out.status.code() {
            Some(126) | Some(127) => "The firewall was not changed.".to_string(),
            _ => String::from_utf8_lossy(&out.stderr).trim().to_string(),
        });
    }
    #[allow(unreachable_code)]
    {
        let _ = port;
        Err("Only firewalld and ufw on Linux can be opened from here.".to_string())
    }
}

#[cfg(all(test, target_os = "linux"))]
mod firewall_tests {
    use super::*;

    /// ufw counts only when it is switched on (systemctl says "active" either way).
    #[test]
    fn ufw_counts_only_when_enabled() {
        assert!(ufw_enabled("# comment\nENABLED=yes\nLOGLEVEL=low\n"));
        assert!(ufw_enabled("ENABLED = \"yes\""));
        assert!(!ufw_enabled("ENABLED=no\n"));
        assert!(!ufw_enabled("#ENABLED=yes\n"));
        assert!(!ufw_enabled(""));
    }

    /// With firewalld absent, stopped or stuck on D-Bus, the check still answers in seconds.
    #[test]
    fn the_firewall_check_answers_quickly() {
        let t = std::time::Instant::now();
        let info = firewall_info(47120);
        assert!(t.elapsed() < std::time::Duration::from_secs(8));
        match info.tool {
            Some("firewalld") => assert!(info.command.unwrap().contains("--add-port=47120/tcp")),
            Some("ufw") => {
                assert_eq!(info.command.unwrap(), "sudo ufw allow 47120/tcp");
                assert!(info.open.is_none(), "ufw can't tell without admin rights");
            }
            _ => {}
        }
    }
}
