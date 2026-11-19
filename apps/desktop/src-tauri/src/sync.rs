//! Sync on this computer: a folder you already sync (Syncthing, Dropbox, iCloud Drive) as the
//! place for Kenning's encrypted sync files, and requests to sync places the page cannot reach
//! itself (WebDAV servers and other Kenning servers do not send CORS headers for the app).
//!
//! The web app only names a folder the user picked (kept in the config) and paths inside it;
//! every path part is a plain file name, so nothing outside that folder can be reached.

use std::path::{Path, PathBuf};

use tauri::Url;

/// Largest request or file body (one sync file is far smaller).
pub const MAX_BODY: usize = 64 * 1024 * 1024;
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

/// Names directly inside `dir` (empty when it does not exist).
pub fn list(root: &Path, dir: &str) -> Result<Vec<String>, String> {
    let path = root.join(relative(dir, true)?);
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
    let file = root.join(relative(path, false)?);
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
    let file = root.join(relative(path, false)?);
    let dir = file.parent().ok_or("A file name is needed.")?;
    std::fs::create_dir_all(dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    let name = file.file_name().unwrap_or_default().to_string_lossy();
    let tmp = dir.join(format!(".{name}.writing"));
    std::fs::write(&tmp, bytes).map_err(|e| format!("Could not write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, &file).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Could not write {}: {e}", file.display())
    })
}

pub fn remove(root: &Path, path: &str) -> Result<(), String> {
    let file = root.join(relative(path, false)?);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_stay_inside_the_folder() {
        assert_eq!(
            relative("kenning/devices/ab12/01J.kev", false).unwrap(),
            PathBuf::from("kenning")
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
            "kenning/ü",
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
        assert_eq!(list(root, "kenning").unwrap(), Vec::<String>::new());
        assert_eq!(get(root, "kenning/vault.json").unwrap(), None);
        put(root, "kenning/devices/ab/1.kev", b"one").unwrap();
        put(root, "kenning/vault.json", b"{}").unwrap();
        assert_eq!(
            list(root, "kenning").unwrap(),
            vec!["devices", "vault.json"]
        );
        assert_eq!(list(root, "kenning/devices/ab").unwrap(), vec!["1.kev"]);
        assert_eq!(
            get(root, "kenning/devices/ab/1.kev").unwrap(),
            Some(b"one".to_vec())
        );
        // No temporary file is left behind; a hidden one would not be listed anyway.
        std::fs::write(root.join("kenning/.x.writing"), b"half").unwrap();
        assert_eq!(
            list(root, "kenning").unwrap(),
            vec!["devices", "vault.json"]
        );
        put(root, "kenning/devices/ab/1.kev", b"two").unwrap();
        assert_eq!(
            get(root, "kenning/devices/ab/1.kev").unwrap(),
            Some(b"two".to_vec())
        );
        remove(root, "kenning/devices/ab/1.kev").unwrap();
        remove(root, "kenning/devices/ab/1.kev").unwrap();
        assert_eq!(
            list(root, "kenning/devices/ab").unwrap(),
            Vec::<String>::new()
        );
        assert!(put(root, "../outside", b"x").is_err());
    }

    #[test]
    fn requests_are_http_with_sync_methods() {
        assert!(check_request("https://dav.example.org/kenning/", "propfind").is_ok());
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
}
