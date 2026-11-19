//! The sync key, kept by the system: the macOS Keychain, the Windows Credential Manager, or the
//! Secret Service on Linux (GNOME Keyring, KWallet). The page hands the key over once and asks
//! for it when it syncs; it never sits in the page's own storage.
//!
//! When the system has no keychain (a Linux desktop without a Secret Service running), the key
//! goes to a file in the app's data folder that only this user can read (0600). That is no
//! weaker than the database file next to it, and the page reports which of the two it got.

use std::path::{Path, PathBuf};

/// The keychain entry: one sync key per user of this computer.
const SERVICE: &str = "app.kenning.desktop";
const ACCOUNT: &str = "sync-key";
/// The fallback file's name in the app data folder.
pub const KEY_FILE: &str = "sync-key";
/// A key as the page sends it: base64 of 64 bytes is 88 characters; anything far larger is not
/// a key.
const MAX_KEY: usize = 1024;

/// Where the key was kept.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Kept {
    Keychain,
    File,
}

fn entry() -> Result<keyring::Entry, keyring::Error> {
    keyring::Entry::new(SERVICE, ACCOUNT)
}

fn check(key: &str) -> Result<(), String> {
    if key.is_empty() || key.len() > MAX_KEY || !key.is_ascii() {
        return Err("This is not a sync key.".into());
    }
    Ok(())
}

/// Keep `key` (base64), in the keychain when there is one, else in `file`.
pub fn save(key: &str, file: &Path) -> Result<Kept, String> {
    check(key)?;
    if entry().and_then(|e| e.set_password(key)).is_ok() {
        // An older copy in the file is no longer the one in use.
        let _ = std::fs::remove_file(file);
        return Ok(Kept::Keychain);
    }
    write_private(file, key.as_bytes())?;
    Ok(Kept::File)
}

/// The kept key, or None when there is none.
pub fn load(file: &Path) -> Result<Option<String>, String> {
    // Otherwise (no keychain entry, or no keychain at all) the file may hold it.
    if let Ok(key) = entry().and_then(|e| e.get_password()) {
        return Ok(Some(key));
    }
    match std::fs::read_to_string(file) {
        Ok(key) => Ok(Some(key.trim().to_string()).filter(|k| !k.is_empty())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Could not read the sync key: {e}")),
    }
}

/// Forget the key everywhere it may be kept.
pub fn forget(file: &Path) -> Result<(), String> {
    if let Ok(e) = entry() {
        match e.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            // No keychain: nothing was kept there.
            Err(keyring::Error::NoStorageAccess(_)) | Err(keyring::Error::PlatformFailure(_)) => {}
            Err(other) => return Err(format!("Could not forget the sync key: {other}")),
        }
    }
    match std::fs::remove_file(file) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Could not forget the sync key: {e}")),
    }
}

/// Write `bytes` to `file` so that only this user can read it: created 0600 (on Unix) as a
/// temporary file, then renamed over the old one.
pub fn write_private(file: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write as _;
    let dir = file.parent().ok_or("No folder for the sync key.")?;
    std::fs::create_dir_all(dir).map_err(|e| format!("Could not keep the sync key: {e}"))?;
    let tmp: PathBuf = dir.join(format!(
        ".{}.writing",
        file.file_name().unwrap_or_default().to_string_lossy()
    ));
    let _ = std::fs::remove_file(&tmp);
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.mode(0o600);
    }
    let written = options.open(&tmp).and_then(|mut f| {
        f.write_all(bytes)?;
        f.sync_all()
    });
    let result = written.and_then(|()| std::fs::rename(&tmp, file));
    if let Err(e) = result {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("Could not keep the sync key: {e}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_fallback_file_is_private_and_replaced_whole() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("data").join(KEY_FILE);
        write_private(&file, b"first").unwrap();
        write_private(&file, b"second").unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), b"second");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let mode = std::fs::metadata(&file).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        let names: Vec<_> = std::fs::read_dir(file.parent().unwrap())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(names, vec![std::ffi::OsString::from(KEY_FILE)]);
    }

    #[test]
    fn only_key_shaped_text_is_kept() {
        assert!(check("").is_err());
        assert!(check(&"A".repeat(MAX_KEY + 1)).is_err());
        assert!(check("sleutel·").is_err());
        assert!(check(&"A".repeat(88)).is_ok());
    }
}
