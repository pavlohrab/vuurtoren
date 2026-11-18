//! The bundled language server (D4): `kenning-nlp`, a PyInstaller build of server/nlp, started
//! as a child process on a free 127.0.0.1 port with a random token. The web app never talks to
//! it directly: its `/nlp/...` requests go to the `kenning-nlp:` protocol (see `proxy`), which
//! adds the token in Rust. The process is stopped when the app exits; if the app dies, the
//! sidecar sees its stdin close and exits by itself (kenning_nlp/sidecar.py).

use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value as Json;

pub const TOKEN_HEADER: &str = "x-kenning-token";
/// Name of the bundled folder and executable (`sidecar/kenning-nlp/kenning-nlp[.exe]`).
const NAME: &str = "kenning-nlp";
/// First start of a fresh install can be slow (unpacking, antivirus scans on Windows).
pub const START_TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", tag = "state")]
pub enum NlpState {
    /// Not started yet (server mode, or before the first local start).
    Idle,
    Starting,
    Ready,
    /// No sidecar in this build (development build without `build_sidecar.py`).
    Missing,
    Failed {
        error: String,
    },
}

/// Where the language server runs and how to reach it.
pub struct Sidecar {
    pub state: Mutex<NlpState>,
    /// `http://127.0.0.1:<port>` (or `KENNING_NLP_URL` in development).
    pub base: Mutex<Option<String>>,
    pub token: String,
    child: Mutex<Option<Child>>,
    /// The last `/health` answer (pack progress for the first-run screen).
    pub health: Mutex<Option<Json>>,
}

impl Default for Sidecar {
    fn default() -> Self {
        Self::with_token(random_token())
    }
}

pub fn random_token() -> String {
    let mut bytes = [0u8; 24];
    getrandom::fill(&mut bytes).expect("random bytes");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// A port nobody listens on right now (the OS picks it).
pub fn free_port() -> std::io::Result<u16> {
    Ok(TcpListener::bind(("127.0.0.1", 0))?.local_addr()?.port())
}

fn exe_name() -> String {
    format!("{NAME}{}", std::env::consts::EXE_SUFFIX)
}

/// The sidecar executable: `$KENNING_SIDECAR`, else `<resources>/sidecar/kenning-nlp/…`, else
/// (development) `src-tauri/sidecar/kenning-nlp/…` next to the sources.
pub fn locate(resource_dir: Option<&Path>) -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("KENNING_SIDECAR") {
        return Some(PathBuf::from(p)).filter(|p| p.is_file());
    }
    let mut candidates = vec![];
    if let Some(dir) = resource_dir {
        candidates.push(dir.join("sidecar").join(NAME).join(exe_name()));
    }
    if cfg!(debug_assertions) {
        candidates.push(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("sidecar")
                .join(NAME)
                .join(exe_name()),
        );
    }
    candidates.into_iter().find(|p| p.is_file())
}

/// Bundled pack archives (offline installer), if this build has them.
pub fn bundled_packs(resource_dir: Option<&Path>) -> Option<PathBuf> {
    let dir = resource_dir?.join("sidecar").join("packs");
    dir.is_dir().then_some(dir)
}

/// Everything the sidecar is started with (kenning_nlp/sidecar.py documents the variables).
pub struct Launch<'a> {
    pub exe: &'a Path,
    pub port: u16,
    pub token: &'a str,
    pub data_dir: &'a Path,
    pub cache_dir: &'a Path,
    pub packs_dir: Option<&'a Path>,
}

pub fn command(l: &Launch<'_>) -> Command {
    let mut cmd = Command::new(l.exe);
    cmd.env("KENNING_PORT", l.port.to_string())
        .env("KENNING_NLP_TOKEN", l.token)
        .env("KENNING_DATA_DIR", l.data_dir)
        .env("KENNING_PACKS", "download")
        .env("KENNING_COURSE_CACHE_DIR", l.cache_dir.join("course"))
        .env("PYTHONPYCACHEPREFIX", l.cache_dir.join("pycache"))
        .env("PYTHONUNBUFFERED", "1")
        .env_remove("KENNING_CORS_ORIGINS")
        .env_remove("PYTHONHOME")
        .env_remove("PYTHONPATH")
        .stdin(Stdio::piped())
        .stdout(Stdio::null());
    match l.packs_dir {
        Some(dir) => cmd.env("KENNING_PACKS_DIR", dir),
        None => cmd.env_remove("KENNING_PACKS_DIR"),
    };
    if let Some(dir) = l.exe.parent() {
        cmd.current_dir(dir);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

impl Sidecar {
    pub fn with_token(token: String) -> Self {
        Self {
            state: Mutex::new(NlpState::Idle),
            base: Mutex::new(None),
            token,
            child: Mutex::new(None),
            health: Mutex::new(None),
        }
    }

    pub fn state(&self) -> NlpState {
        self.state.lock().unwrap().clone()
    }

    pub fn set_state(&self, state: NlpState) {
        *self.state.lock().unwrap() = state;
    }

    pub fn base(&self) -> Option<String> {
        self.base.lock().unwrap().clone()
    }

    /// Start the process (not waiting for it to answer). Errors are also stored as `Failed`.
    pub fn spawn(&self, launch: &Launch<'_>, log: &Path) -> Result<(), String> {
        let _ = std::fs::create_dir_all(launch.data_dir);
        let _ = std::fs::create_dir_all(launch.cache_dir);
        let mut cmd = command(launch);
        match std::fs::File::create(log) {
            Ok(f) => cmd.stderr(f),
            Err(_) => cmd.stderr(Stdio::null()),
        };
        let child = cmd.spawn().map_err(|e| {
            let msg = format!("The language server could not be started: {e}");
            self.set_state(NlpState::Failed { error: msg.clone() });
            msg
        })?;
        *self.child.lock().unwrap() = Some(child);
        *self.base.lock().unwrap() = Some(format!("http://127.0.0.1:{}", launch.port));
        self.set_state(NlpState::Starting);
        Ok(())
    }

    /// Did the child exit? (Its exit status, for the error message.)
    pub fn exited(&self) -> Option<String> {
        let mut guard = self.child.lock().unwrap();
        let child = guard.as_mut()?;
        match child.try_wait() {
            Ok(Some(status)) => Some(status.to_string()),
            _ => None,
        }
    }

    /// Stop the process (app exit, restart).
    pub fn stop(&self) {
        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        *self.base.lock().unwrap() = None;
    }

    /// Poll `/health` until it answers, the child dies or the timeout passes.
    pub async fn wait_ready(&self, client: &reqwest::Client, timeout: Duration) -> NlpState {
        let started = Instant::now();
        loop {
            if let Some(health) = self.fetch_health(client).await {
                *self.health.lock().unwrap() = Some(health);
                self.set_state(NlpState::Ready);
                return NlpState::Ready;
            }
            if let Some(status) = self.exited() {
                let state = NlpState::Failed {
                    error: format!("The language server stopped ({status})."),
                };
                self.set_state(state.clone());
                return state;
            }
            if started.elapsed() > timeout {
                let state = NlpState::Failed {
                    error: "The language server did not start in time.".into(),
                };
                self.set_state(state.clone());
                return state;
            }
            tokio::time::sleep(Duration::from_millis(300)).await;
        }
    }

    pub async fn fetch_health(&self, client: &reqwest::Client) -> Option<Json> {
        let base = self.base()?;
        let res = client
            .get(format!("{base}/health"))
            .header(TOKEN_HEADER, &self.token)
            .timeout(Duration::from_secs(5))
            .send()
            .await
            .ok()?;
        if !res.status().is_success() {
            return None;
        }
        res.json().await.ok()
    }

    /// Is the dictionary pack being fetched right now? (Analysis waits for it, see `proxy`.)
    pub fn dictionary_busy(&self) -> bool {
        self.health
            .lock()
            .unwrap()
            .as_ref()
            .and_then(|h| h.pointer("/packs/items/dictionary-nl/activity"))
            .is_some()
    }
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn http() -> reqwest::Client {
        let _ = rustls::crypto::ring::default_provider().install_default();
        reqwest::Client::new()
    }

    #[test]
    fn tokens_are_random_and_long() {
        let a = random_token();
        assert_eq!(a.len(), 48);
        assert_ne!(a, random_token());
    }

    #[test]
    fn free_port_is_bindable() {
        let port = free_port().unwrap();
        assert!(port > 0);
        TcpListener::bind(("127.0.0.1", port)).unwrap();
    }

    #[test]
    fn launch_environment() {
        let exe = Path::new("/opt/kenning/sidecar/kenning-nlp/kenning-nlp");
        let cmd = command(&Launch {
            exe,
            port: 4321,
            token: "tok",
            data_dir: Path::new("/data"),
            cache_dir: Path::new("/cache"),
            packs_dir: Some(Path::new("/opt/kenning/sidecar/packs")),
        });
        let env: std::collections::HashMap<_, _> = cmd
            .get_envs()
            .map(|(k, v)| {
                (
                    k.to_string_lossy().to_string(),
                    v.map(|v| v.to_string_lossy().to_string()),
                )
            })
            .collect();
        let get = |k: &str| env.get(k).cloned().flatten();
        assert_eq!(get("KENNING_PORT").as_deref(), Some("4321"));
        assert_eq!(get("KENNING_NLP_TOKEN").as_deref(), Some("tok"));
        assert_eq!(get("KENNING_DATA_DIR").as_deref(), Some("/data"));
        assert_eq!(get("KENNING_PACKS").as_deref(), Some("download"));
        assert_eq!(
            get("KENNING_PACKS_DIR").as_deref(),
            Some("/opt/kenning/sidecar/packs")
        );
        assert_eq!(
            get("PYTHONPYCACHEPREFIX").as_deref(),
            Some("/cache/pycache")
        );
        // Removed, so a developer's shell cannot leak into the bundled Python.
        assert!(env.contains_key("PYTHONPATH") && get("PYTHONPATH").is_none());
        assert_eq!(cmd.get_current_dir(), exe.parent());
    }

    #[test]
    fn missing_sidecar_is_reported_not_guessed() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            locate(Some(dir.path())).filter(|p| p.starts_with(dir.path())),
            None
        );
        let exe = dir.path().join("sidecar").join(NAME).join(exe_name());
        std::fs::create_dir_all(exe.parent().unwrap()).unwrap();
        std::fs::write(&exe, b"").unwrap();
        assert_eq!(locate(Some(dir.path())), Some(exe));
        assert_eq!(bundled_packs(Some(dir.path())), None);
        std::fs::create_dir_all(dir.path().join("sidecar").join("packs")).unwrap();
        assert!(bundled_packs(Some(dir.path())).is_some());
    }

    /// Start a fake sidecar (a tiny HTTP server in a shell script is not portable, so this uses
    /// a process that exits at once) and check that the failure is reported, not hung on.
    #[cfg(unix)]
    #[test]
    fn a_crashing_sidecar_fails_fast() {
        let dir = tempfile::tempdir().unwrap();
        let exe = dir.path().join("fake");
        std::fs::write(&exe, "#!/bin/sh\nexit 3\n").unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755)).unwrap();
        let sidecar = Sidecar::default();
        let launch = Launch {
            exe: &exe,
            port: free_port().unwrap(),
            token: &sidecar.token,
            data_dir: &dir.path().join("data"),
            cache_dir: &dir.path().join("cache"),
            packs_dir: None,
        };
        sidecar.spawn(&launch, &dir.path().join("log")).unwrap();
        assert_eq!(sidecar.state(), NlpState::Starting);
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let client = http();
        let state = rt.block_on(sidecar.wait_ready(&client, Duration::from_secs(20)));
        assert!(
            matches!(&state, NlpState::Failed { error } if error.contains("stopped")),
            "{state:?}"
        );
        sidecar.stop();
        assert_eq!(sidecar.base(), None);
    }

    /// A stand-in sidecar that answers `/health` (std only): ready, then stopped.
    #[test]
    fn ready_when_health_answers_and_stopped_on_request() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            use std::io::{Read, Write};
            for mut s in listener.incoming().flatten() {
                let mut buf = [0u8; 2048];
                let n = s.read(&mut buf).unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]).to_lowercase();
                let (status, body) = if req.contains("x-kenning-token: secret") {
                    (
                        "200 OK",
                        r#"{"status":"ok","packs":{"items":{"dictionary-nl":{"activity":"downloading"}}}}"#,
                    )
                } else {
                    ("401 Unauthorized", r#"{"detail":"no"}"#)
                };
                let _ = write!(
                    s,
                    "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
            }
        });
        let sidecar = Sidecar::with_token("secret".into());
        *sidecar.base.lock().unwrap() = Some(format!("http://127.0.0.1:{port}"));
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let client = http();
        assert_eq!(
            rt.block_on(sidecar.wait_ready(&client, Duration::from_secs(5))),
            NlpState::Ready
        );
        assert!(sidecar.dictionary_busy());
        let wrong = Sidecar::with_token("wrong".into());
        *wrong.base.lock().unwrap() = Some(format!("http://127.0.0.1:{port}"));
        assert!(matches!(
            rt.block_on(wrong.wait_ready(&client, Duration::from_millis(700))),
            NlpState::Failed { .. }
        ));
    }
}
