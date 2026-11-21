//! The sync key, kept by the device's key store, and next to it a server's sync token on a
//! device connected with a pairing code. The page hands a secret over once and asks for it when
//! it syncs; it never sits in the page's own storage.
//!
//! - A computer (`SystemKeys`): the macOS Keychain, the Windows Credential Manager, or the
//!   Secret Service on Linux (GNOME Keyring, KWallet). When the system has no keychain (a Linux
//!   desktop without a Secret Service running), the key goes to a file in the app's data folder
//!   that only this user can read (0600). That is no weaker than the database file next to it,
//!   and the page reports which of the two it got.
//! - Android (`mobile.rs`): the Kotlin plugin `KeystorePlugin` seals the key with an AES key
//!   that the Android Keystore holds and never hands out; the sealed key is in the app's private
//!   storage, excluded from backups.

// Android keeps the key in its Keystore: the file helpers are for the other devices.
#![cfg_attr(target_os = "android", allow(dead_code))]

use std::path::{Path, PathBuf};

/// The entries a page may keep: the sync key (the default) and a server's sync token. Each is
/// a keychain account and the name of its fallback file in the app data folder.
const ENTRIES: [&str; 2] = ["sync-key", "sync-token"];
/// A key as the page sends it: base64 of 64 bytes is 88 characters; anything far larger is not
/// a key.
const MAX_KEY: usize = 1024;

/// Where the key was kept.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // each device makes only some of them
pub enum Kept {
    /// The system keychain of a computer.
    Keychain,
    /// A private file in the app's data folder.
    File,
    /// The Android Keystore.
    Keystore,
}

/// What keeps the secrets on this device (blocking calls; the commands run them off the main
/// thread). `name` is one of `ENTRIES` (see `entry`).
pub trait KeyStore: Send + Sync {
    /// Keep `key` (ASCII: base64 or a token), replacing the one kept before under `name`.
    fn save(&self, name: &str, key: &str) -> Result<Kept, String>;
    /// The kept secret, or None when there is none. A store that fails is an error, not None.
    fn load(&self, name: &str) -> Result<Option<String>, String>;
    /// Forget the secret everywhere it may be kept.
    fn forget(&self, name: &str) -> Result<(), String>;
}

/// The entry a page asks for: the sync key when it names none, else one of `ENTRIES`.
pub fn entry(name: Option<&str>) -> Result<&'static str, String> {
    let name = name.unwrap_or(ENTRIES[0]);
    ENTRIES
        .into_iter()
        .find(|e| *e == name)
        .ok_or_else(|| format!("Vuurtoren keeps no secret called {name:?}."))
}

pub fn check(key: &str) -> Result<(), String> {
    if key.is_empty() || key.len() > MAX_KEY || !key.is_ascii() {
        return Err("This is not a sync key.".into());
    }
    Ok(())
}

/// The key in a private file (the fallback on a computer; the store on iOS).
fn file_load(file: &Path) -> Result<Option<String>, String> {
    match std::fs::read_to_string(file) {
        Ok(key) => Ok(Some(key.trim().to_string()).filter(|k| !k.is_empty())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Could not read the sync key: {e}")),
    }
}

fn file_forget(file: &Path) -> Result<(), String> {
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

/// Private files in the app's sandbox (iOS, until it has a Keychain plugin); the folder holds
/// one file per entry.
#[cfg(all(mobile, not(target_os = "android")))]
pub struct FileKeys(pub PathBuf);

#[cfg(all(mobile, not(target_os = "android")))]
impl KeyStore for FileKeys {
    fn save(&self, name: &str, key: &str) -> Result<Kept, String> {
        check(key)?;
        write_private(&self.0.join(name), key.as_bytes())?;
        Ok(Kept::File)
    }
    fn load(&self, name: &str) -> Result<Option<String>, String> {
        file_load(&self.0.join(name))
    }
    fn forget(&self, name: &str) -> Result<(), String> {
        file_forget(&self.0.join(name))
    }
}

#[cfg(desktop)]
pub use system::SystemKeys;

#[cfg(desktop)]
mod system {
    use super::*;

    /// The keychain service; each entry is an account of it (one per user of this computer).
    const SERVICE: &str = "app.vuurtoren.desktop";

    /// The system keychain, with private files in `dir` (the app data folder) when there is none.
    pub struct SystemKeys {
        dir: PathBuf,
    }

    impl SystemKeys {
        pub fn new(dir: PathBuf) -> Self {
            Self { dir }
        }
    }

    fn keychain(name: &str) -> Result<keyring::Entry, keyring::Error> {
        keyring::Entry::new(SERVICE, name)
    }

    impl KeyStore for SystemKeys {
        /// In the keychain when there is one, else in the file.
        fn save(&self, name: &str, key: &str) -> Result<Kept, String> {
            check(key)?;
            let file = self.dir.join(name);
            if keychain(name).and_then(|e| e.set_password(key)).is_ok() {
                // An older copy in the file is no longer the one in use.
                let _ = std::fs::remove_file(&file);
                return Ok(Kept::Keychain);
            }
            write_private(&file, key.as_bytes())?;
            Ok(Kept::File)
        }

        /// A keychain that fails (locked, access refused) is an error, unless the fallback file
        /// holds the key.
        fn load(&self, name: &str) -> Result<Option<String>, String> {
            let kept = keychain(name).and_then(|e| e.get_password());
            if let Ok(key) = kept {
                return Ok(Some(key));
            }
            keychain_answer(kept, file_load(&self.dir.join(name))?)
        }

        fn forget(&self, name: &str) -> Result<(), String> {
            if let Ok(e) = keychain(name) {
                match e.delete_credential() {
                    Ok(()) | Err(keyring::Error::NoEntry) => {}
                    // No keychain: nothing was kept there.
                    Err(keyring::Error::NoStorageAccess(_))
                    | Err(keyring::Error::PlatformFailure(_)) => {}
                    Err(other) => return Err(format!("Could not forget the sync key: {other}")),
                }
            }
            file_forget(&self.dir.join(name))
        }
    }

    /// What `load` answers from the keychain's failure and the fallback file.
    pub(super) fn keychain_answer(
        keychain: Result<String, keyring::Error>,
        from_file: Option<String>,
    ) -> Result<Option<String>, String> {
        match (keychain, from_file) {
            (Ok(key), _) => Ok(Some(key)),
            (_, Some(key)) => Ok(Some(key)),
            (Err(keyring::Error::NoEntry), None) => Ok(None),
            (Err(e), None) => Err(format!(
                "The system keychain did not give Vuurtoren its sync key ({e}). Unlock the keychain, then sync again."
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_fallback_file_is_private_and_replaced_whole() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("data").join("sync-key");
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
        assert_eq!(names, vec![std::ffi::OsString::from("sync-key")]);
        assert_eq!(file_load(&file).unwrap().as_deref(), Some("second"));
        file_forget(&file).unwrap();
        assert_eq!(file_load(&file).unwrap(), None);
        file_forget(&file).unwrap();
    }

    #[cfg(desktop)]
    #[test]
    fn a_failing_keychain_is_an_error_not_a_missing_key() {
        use system::keychain_answer;
        let key = || Some("A".repeat(88));
        assert_eq!(
            keychain_answer(Err(keyring::Error::NoEntry), None),
            Ok(None)
        );
        assert_eq!(
            keychain_answer(Err(keyring::Error::NoEntry), key()),
            Ok(key())
        );
        let locked = keychain_answer(Err(keyring::Error::NoStorageAccess("locked".into())), None);
        assert!(locked.unwrap_err().contains("keychain"));
        // No keychain on this system: the key is in the file.
        assert_eq!(
            keychain_answer(
                Err(keyring::Error::PlatformFailure("no service".into())),
                key()
            ),
            Ok(key())
        );
    }

    #[test]
    fn a_page_names_only_the_known_entries() {
        assert_eq!(entry(None), Ok("sync-key"));
        assert_eq!(entry(Some("sync-token")), Ok("sync-token"));
        assert!(entry(Some("../sync-key")).is_err());
        assert!(entry(Some("")).is_err());
    }

    #[test]
    fn only_key_shaped_text_is_kept() {
        assert!(check("").is_err());
        assert!(check(&"A".repeat(MAX_KEY + 1)).is_err());
        assert!(check("sleutel·").is_err());
        assert!(check(&"A".repeat(88)).is_ok());
    }
}
