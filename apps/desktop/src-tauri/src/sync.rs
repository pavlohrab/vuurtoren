//! Sync on this device: on a computer a folder you already sync (Syncthing, Dropbox, iCloud Drive) as the
//! place for Vuurtoren's encrypted sync files, and requests to sync places the page cannot reach
//! itself (many WebDAV servers send no CORS headers for the app).
//!
//! The web app only names a folder the user picked (kept in the config) and paths inside it;
//! every path part is a plain file name and links are not followed, so nothing outside that
//! folder can be reached.
//!
//! Requests go only to addresses the user allowed (a question from the app the first time a
//! sync place's address is used), never follow a redirect to another address, carry no
//! cookies, and stop reading an answer as soon as it is larger than a sync file can be. A phone
//! syncs with a server only, so the folder half is for computers.

// Phones have no sync folders.
#![cfg_attr(mobile, allow(dead_code))]

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use tauri::Url;

/// Largest request or file body (one sync file is far smaller).
pub const MAX_BODY: usize = 64 * 1024 * 1024;
/// Redirects followed within one address (a WebDAV server adding a trailing slash).
const MAX_REDIRECTS: usize = 5;
/// Request headers the page may not set: the app sends its own Host and length, keeps no
/// cookies, and the hop-by-hop headers belong to the connection, not to the request.
const DROPPED_HEADERS: [&str; 13] = [
    "host",
    "cookie",
    "cookie2",
    "content-length",
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "proxy-connection",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
];
/// Methods a sync place needs (WebDAV adds PROPFIND and MKCOL).
const METHODS: [&str; 8] = [
    "GET", "HEAD", "PUT", "POST", "DELETE", "PROPFIND", "MKCOL", "OPTIONS",
];

/// One path part: letters, digits, `.`, `_` and `-`; never `.` or `..`.
fn valid_part(part: &str) -> bool {
    !part.is_empty()
        && part != "."
        && part != ".."
        && part
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

/// A relative, `/`-separated path inside a sync folder (empty for the folder itself when
/// `allow_empty`).
pub fn relative(path: &str, allow_empty: bool) -> Result<PathBuf, String> {
    if path.is_empty() {
        return if allow_empty {
            Ok(PathBuf::new())
        } else {
            Err("A file name is needed.".into())
        };
    }
    let mut out = PathBuf::new();
    for part in path.split('/') {
        if !valid_part(part) {
            return Err(format!(
                "\"{path}\" is not a path inside the sync folder (letters, digits, . _ - and / only)."
            ));
        }
        out.push(part);
    }
    Ok(out)
}

/// The sync folder, if it is one the user picked.
pub fn allowed_root(root: &str, roots: &[String]) -> Result<PathBuf, String> {
    if roots.iter().any(|r| r == root) {
        Ok(PathBuf::from(root))
    } else {
        Err("Choose the sync folder in Settings first.".into())
    }
}

/// `path` inside the sync folder, refusing symbolic links on the way: a device that syncs the
/// same folder (a Syncthing peer, a shared Dropbox folder) could otherwise place a link that
/// sends Vuurtoren's reads and writes elsewhere on this computer. Parts that do not exist yet
/// are fine (`put` creates them as plain folders); what exists must resolve inside the folder.
pub fn inside(root: &Path, path: &str, allow_empty: bool) -> Result<PathBuf, String> {
    let rel = relative(path, allow_empty)?;
    // The folder the user picked may itself be a link (a Dropbox folder kept on another disk).
    let base = std::fs::canonicalize(root)
        .map_err(|e| format!("The sync folder {} cannot be opened: {e}", root.display()))?;
    let mut at = base.clone();
    for part in rel.components() {
        at.push(part);
        match std::fs::symlink_metadata(&at) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(format!(
                    "{} is a link to another place. Vuurtoren only uses plain files and folders inside the sync folder.",
                    at.display()
                ));
            }
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(base.join(&rel)),
            Err(e) => return Err(format!("Could not read {}: {e}", at.display())),
        }
    }
    let real =
        std::fs::canonicalize(&at).map_err(|e| format!("Could not read {}: {e}", at.display()))?;
    if !real.starts_with(&base) {
        return Err(format!("{} is outside the sync folder.", at.display()));
    }
    Ok(at)
}

/// Names directly inside `dir` (empty when it does not exist).
pub fn list(root: &Path, dir: &str) -> Result<Vec<String>, String> {
    let path = inside(root, dir, true)?;
    let entries = match std::fs::read_dir(&path) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(format!("Could not read {}: {e}", path.display())),
    };
    let mut names: Vec<String> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        // Our own half-written files and other tools' hidden files are not sync files.
        .filter(|n| !n.starts_with('.') && valid_part(n))
        .collect();
    names.sort();
    Ok(names)
}

pub fn get(root: &Path, path: &str) -> Result<Option<Vec<u8>>, String> {
    let file = inside(root, path, false)?;
    // A sync file is never larger than a request body may be.
    if std::fs::metadata(&file).is_ok_and(|m| m.len() > MAX_BODY as u64) {
        return Err(format!(
            "{} is too large to be a sync file.",
            file.display()
        ));
    }
    match std::fs::read(&file) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Could not read {}: {e}", file.display())),
    }
}

/// Write a file whole: to a hidden temporary file next to it, then renamed, so a syncing tool
/// never copies half of it.
pub fn put(root: &Path, path: &str, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > MAX_BODY {
        return Err("This file is too large to sync.".into());
    }
    let file = inside(root, path, false)?;
    let dir = file.parent().ok_or("A file name is needed.")?;
    std::fs::create_dir_all(dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    // Checked again now that the folders exist (another program may have made one a link).
    let file = inside(root, path, false)?;
    let dir = file.parent().ok_or("A file name is needed.")?;
    let name = file.file_name().unwrap_or_default().to_string_lossy();
    let tmp = dir.join(format!(".{name}.writing"));
    // A leftover (or planted) temporary file goes first; `create_new` never follows a link.
    let _ = std::fs::remove_file(&tmp);
    let written = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tmp)
        .and_then(|mut f| {
            use std::io::Write as _;
            f.write_all(bytes)
        });
    if let Err(e) = written {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("Could not write {}: {e}", tmp.display()));
    }
    // A rename replaces what is at `file` (a link itself, never what it points to).
    std::fs::rename(&tmp, &file).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Could not write {}: {e}", file.display())
    })
}

pub fn remove(root: &Path, path: &str) -> Result<(), String> {
    let file = inside(root, path, false)?;
    match std::fs::remove_file(&file) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Could not remove {}: {e}", file.display())),
    }
}

/// A sync request's address and method, checked: http(s) only, the methods a sync place needs.
pub fn check_request(url: &str, method: &str) -> Result<(Url, String), String> {
    let parsed = Url::parse(url).map_err(|_| format!("\"{url}\" is not a web address."))?;
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return Err("A sync address must start with https:// or http://.".into());
    }
    if parsed.host_str().is_none() {
        return Err(format!("\"{url}\" is not a web address."));
    }
    let m = method.to_ascii_uppercase();
    if !METHODS.contains(&m.as_str()) {
        return Err(format!("The method {method} is not used for sync."));
    }
    Ok((parsed, m))
}

/// The address a permission is kept for: scheme, host and port (`https://dav.example.org`).
pub fn origin(url: &Url) -> String {
    url.origin().ascii_serialization()
}

/// The page's request headers without the ones the app sets itself or never sends.
pub fn request_headers(headers: &HashMap<String, String>) -> Vec<(&str, &str)> {
    headers
        .iter()
        .filter(|(name, _)| {
            let lower = name.to_ascii_lowercase();
            !DROPPED_HEADERS.contains(&lower.as_str())
        })
        .map(|(n, v)| (n.as_str(), v.as_str()))
        .collect()
}

/// Answer headers for the page (cookies are not kept, so `Set-Cookie` is left out).
pub fn response_headers(headers: &reqwest::header::HeaderMap) -> HashMap<String, String> {
    headers
        .iter()
        .filter(|(name, _)| *name != reqwest::header::SET_COOKIE)
        .filter_map(|(k, v)| {
            v.to_str()
                .ok()
                .map(|v| (k.as_str().to_string(), v.to_string()))
        })
        .collect()
}

/// Redirects are followed only within the address the request went to: a redirect elsewhere
/// comes back to the page as the 3xx answer it is.
pub fn redirect_policy() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(|attempt| {
        let same = attempt
            .previous()
            .first()
            .is_some_and(|first| origin(first) == origin(attempt.url()));
        if same && attempt.previous().len() <= MAX_REDIRECTS {
            attempt.follow()
        } else {
            attempt.stop()
        }
    })
}

/// The answer's body, read piece by piece and given up as soon as it is larger than `max`.
pub async fn read_capped(mut res: reqwest::Response, max: usize) -> Result<Vec<u8>, String> {
    const TOO_LARGE: &str = "The sync place sent more than a sync file can hold.";
    if res.content_length().is_some_and(|n| n > max as u64) {
        return Err(TOO_LARGE.into());
    }
    let mut body = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
        if body.len() + chunk.len() > max {
            return Err(TOO_LARGE.into());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_stay_inside_the_folder() {
        assert_eq!(
            relative("vuurtoren/devices/ab12/01J.kev", false).unwrap(),
            PathBuf::from("vuurtoren")
                .join("devices")
                .join("ab12")
                .join("01J.kev")
        );
        assert!(relative("", true).unwrap().as_os_str().is_empty());
        for bad in [
            "",
            "../x",
            "a/../b",
            "/etc/passwd",
            "a//b",
            "a/./b",
            "a\\b",
            "C:/x",
            "a b",
            "vuurtoren/ü",
            ".",
        ] {
            assert!(relative(bad, false).is_err(), "{bad} should be refused");
        }
    }

    #[test]
    fn only_a_picked_folder_is_a_root() {
        let roots = vec!["/home/me/Sync".to_string()];
        assert!(allowed_root("/home/me/Sync", &roots).is_ok());
        assert!(allowed_root("/home/me", &roots).is_err());
        assert!(allowed_root("/home/me/Sync/..", &roots).is_err());
    }

    #[test]
    fn files_are_written_whole_listed_read_and_removed() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        assert_eq!(list(root, "vuurtoren").unwrap(), Vec::<String>::new());
        assert_eq!(get(root, "vuurtoren/vault.json").unwrap(), None);
        put(root, "vuurtoren/devices/ab/1.kev", b"one").unwrap();
        put(root, "vuurtoren/vault.json", b"{}").unwrap();
        assert_eq!(
            list(root, "vuurtoren").unwrap(),
            vec!["devices", "vault.json"]
        );
        assert_eq!(list(root, "vuurtoren/devices/ab").unwrap(), vec!["1.kev"]);
        assert_eq!(
            get(root, "vuurtoren/devices/ab/1.kev").unwrap(),
            Some(b"one".to_vec())
        );
        // No temporary file is left behind; a hidden one would not be listed anyway.
        std::fs::write(root.join("vuurtoren/.x.writing"), b"half").unwrap();
        assert_eq!(
            list(root, "vuurtoren").unwrap(),
            vec!["devices", "vault.json"]
        );
        put(root, "vuurtoren/devices/ab/1.kev", b"two").unwrap();
        assert_eq!(
            get(root, "vuurtoren/devices/ab/1.kev").unwrap(),
            Some(b"two".to_vec())
        );
        remove(root, "vuurtoren/devices/ab/1.kev").unwrap();
        remove(root, "vuurtoren/devices/ab/1.kev").unwrap();
        assert_eq!(
            list(root, "vuurtoren/devices/ab").unwrap(),
            Vec::<String>::new()
        );
        assert!(put(root, "../outside", b"x").is_err());
    }

    #[test]
    fn requests_are_http_with_sync_methods() {
        assert!(check_request("https://dav.example.org/vuurtoren/", "propfind").is_ok());
        assert_eq!(
            check_request("http://192.168.1.4:8080/x", "MKCOL")
                .unwrap()
                .1,
            "MKCOL"
        );
        assert!(check_request("file:///etc/passwd", "GET").is_err());
        assert!(check_request("ftp://example.org/", "GET").is_err());
        assert!(check_request("not a url", "GET").is_err());
        assert!(check_request("https://example.org/", "CONNECT").is_err());
        assert!(check_request("https://example.org/", "TRACE").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn links_in_the_sync_folder_are_not_followed() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("Sync");
        let elsewhere = dir.path().join("elsewhere");
        std::fs::create_dir_all(root.join("vuurtoren")).unwrap();
        std::fs::create_dir_all(&elsewhere).unwrap();
        std::fs::write(elsewhere.join("secret"), b"private").unwrap();

        // A folder that is a link: nothing is listed, read or written through it.
        symlink(&elsewhere, root.join("vuurtoren").join("devices")).unwrap();
        assert!(list(&root, "vuurtoren/devices").is_err());
        assert!(get(&root, "vuurtoren/devices/secret").is_err());
        assert!(put(&root, "vuurtoren/devices/new.kev", b"x").is_err());
        assert!(remove(&root, "vuurtoren/devices/secret").is_err());
        assert!(!elsewhere.join("new.kev").exists());
        assert!(elsewhere.join("secret").exists());

        // A file that is a link is not read; writing replaces the link, not its target.
        symlink(
            elsewhere.join("secret"),
            root.join("vuurtoren").join("vault.json"),
        )
        .unwrap();
        assert!(get(&root, "vuurtoren/vault.json").is_err());
        assert!(put(&root, "vuurtoren/vault.json", b"{}").is_err());
        assert_eq!(std::fs::read(elsewhere.join("secret")).unwrap(), b"private");

        // A planted temporary file that is a link is removed, not written through.
        symlink(
            elsewhere.join("secret"),
            root.join("vuurtoren").join(".a.kev.writing"),
        )
        .unwrap();
        put(&root, "vuurtoren/a.kev", b"mine").unwrap();
        assert_eq!(std::fs::read(elsewhere.join("secret")).unwrap(), b"private");
        assert_eq!(
            get(&root, "vuurtoren/a.kev").unwrap(),
            Some(b"mine".to_vec())
        );

        // The chosen folder itself may be a link (a synced folder kept on another disk).
        let alias = dir.path().join("SyncAlias");
        symlink(&root, &alias).unwrap();
        assert_eq!(
            get(&alias, "vuurtoren/a.kev").unwrap(),
            Some(b"mine".to_vec())
        );
    }

    #[test]
    fn the_page_cannot_set_connection_or_cookie_headers() {
        let headers: HashMap<String, String> = [
            ("Authorization", "Basic eA=="),
            ("Depth", "1"),
            ("Content-Type", "application/octet-stream"),
            ("Host", "169.254.169.254"),
            ("Cookie", "session=1"),
            ("Connection", "upgrade"),
            ("Transfer-Encoding", "chunked"),
            ("content-length", "1"),
            ("Proxy-Authorization", "x"),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
        let mut kept: Vec<&str> = request_headers(&headers)
            .into_iter()
            .map(|(n, _)| n)
            .collect();
        kept.sort();
        assert_eq!(kept, vec!["Authorization", "Content-Type", "Depth"]);
    }

    /// A tiny HTTP server for the request tests: answers each path with a canned response.
    fn serve(answers: HashMap<&'static str, String>) -> u16 {
        use std::io::{BufRead as _, BufReader, Write as _};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                let path = line.split(' ').nth(1).unwrap_or("/").to_string();
                loop {
                    let mut header = String::new();
                    if reader.read_line(&mut header).unwrap_or(0) <= 2 {
                        break;
                    }
                }
                let answer = answers.get(path.as_str()).cloned().unwrap_or_else(|| {
                    "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n".into()
                });
                let mut stream = stream;
                let _ = stream.write_all(answer.replace("{port}", &port.to_string()).as_bytes());
            }
        });
        port
    }

    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
    }

    #[test]
    fn answers_are_read_up_to_the_cap_and_redirects_stay_on_the_same_address() {
        let close = "Connection: close\r\n";
        let chunked = format!(
            "HTTP/1.1 200 OK\r\n{close}Transfer-Encoding: chunked\r\n\r\n{}0\r\n\r\n",
            "400\r\n".to_string() + &"x".repeat(0x400) + "\r\n"
        );
        let answers: HashMap<&'static str, String> = [
            ("/ok", format!("HTTP/1.1 200 OK\r\n{close}Content-Length: 2\r\nSet-Cookie: a=b\r\n\r\nok")),
            ("/chunked", chunked),
            ("/declared", format!("HTTP/1.1 200 OK\r\n{close}Content-Length: 999999\r\n\r\n")),
            ("/same", format!("HTTP/1.1 302 Found\r\n{close}Location: /ok\r\nContent-Length: 0\r\n\r\n")),
            (
                "/other",
                format!("HTTP/1.1 302 Found\r\n{close}Location: http://localhost:{{port}}/ok\r\nContent-Length: 0\r\n\r\n"),
            ),
        ]
        .into_iter()
        .collect();
        let port = serve(answers);
        let client = reqwest::Client::builder()
            .redirect(redirect_policy())
            .build()
            .unwrap();
        let get = |path: &str| client.get(format!("http://127.0.0.1:{port}{path}")).send();
        runtime().block_on(async {
            let ok = get("/ok").await.unwrap();
            assert!(!response_headers(ok.headers()).contains_key("set-cookie"));
            assert_eq!(read_capped(ok, 10).await.unwrap(), b"ok");
            // No length given: the body is counted as it arrives.
            assert!(read_capped(get("/chunked").await.unwrap(), 100)
                .await
                .is_err());
            assert_eq!(
                read_capped(get("/chunked").await.unwrap(), 2048)
                    .await
                    .unwrap()
                    .len(),
                0x400
            );
            // A declared length over the cap is refused before reading.
            assert!(read_capped(get("/declared").await.unwrap(), 1000)
                .await
                .is_err());
            // Same address: followed. Another address: handed back as the redirect.
            let same = get("/same").await.unwrap();
            assert_eq!(same.status(), 200);
            let other = get("/other").await.unwrap();
            assert_eq!(other.status(), 302);
        });
    }
}
