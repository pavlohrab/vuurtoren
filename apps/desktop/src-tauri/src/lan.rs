//! "Connect a phone" (SY1, `.plan/notes/sy1-connect-a-phone.md`): the computer as its own phone's
//! sync place on the home network. This is the core without any HTTP library: the same routes,
//! answers and write rules as the Vuurtoren server's sync API (`server/api/src/server.ts`,
//! `sync.ts`), so the phone's existing server code works unchanged. The HTTPS listener (with the
//! certificate pinned in the QR code) goes on top of [`Lan::dispatch`].
//!
//! Routes: `GET /api/health`, `POST /api/sync/pair` (a one-time code for a phone token),
//! `GET /api/sync/list?dir=`, `GET|PUT|DELETE /api/sync/file?path=`. A phone token writes only
//! its own device folder (`vuurtoren/devices/<device>/…`, the first one it writes becomes its
//! own), shared images (`vuurtoren/blobs/<name>`) and `vuurtoren/vault.json` when there is none.
//! Tokens are kept as SHA-256 hashes.

// Not wired into the app yet (the listener and the Settings screen come next).
#![allow(dead_code)]

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::json;
use sha2::{Digest, Sha256};

/// Largest file a phone may put (the server's `MAX_SYNC_FILE_BYTES`).
pub const MAX_FILE: usize = 64 * 1024 * 1024;
/// How long a pairing code works, and how many wrong tries it takes.
pub const CODE_SECONDS: u64 = 10 * 60;
pub const CODE_TRIES: u32 = 5;
const TMP: &str = ".tmp-";
/// Symbols of a pairing code (no 0/O, 1/I/L), as the server's.
const CODE_SYMBOLS: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/// What a phone token may do.
#[derive(Clone, Debug, PartialEq)]
pub struct Phone {
    /// SHA-256 of the token, hex.
    pub hash: String,
    pub name: String,
    /// Its device folder; `None` until its first write there.
    pub device: Option<String>,
    /// It made `vault.json` (or was allowed to replace it).
    pub vault: bool,
}

struct Code {
    code: String,
    expires: u64,
    tries: u32,
    /// What the phone gets once the code matched: the sync place and key (from the app).
    handover: Option<serde_json::Value>,
}

/// An answer: status, content type and body.
#[derive(Debug, PartialEq)]
pub struct Reply {
    pub status: u16,
    pub content_type: &'static str,
    pub body: Vec<u8>,
}

impl Reply {
    fn json(status: u16, v: serde_json::Value) -> Self {
        Reply {
            status,
            content_type: "application/json",
            body: v.to_string().into_bytes(),
        }
    }
    fn fail(status: u16, error: &str) -> Self {
        Self::json(status, json!({ "ok": false, "error": error }))
    }
}

/// The computer's sync place for its phones.
pub struct Lan {
    root: PathBuf,
    pub phones: Vec<Phone>,
    code: Option<Code>,
    /// The phones changed since they were last saved ([`Lan::take_dirty`]).
    dirty: bool,
}

impl Lan {
    /// True once after the phones changed (paired, claimed a folder): time to save them.
    pub fn take_dirty(&mut self) -> bool {
        std::mem::take(&mut self.dirty)
    }

    /// The phones as saved on disk.
    pub fn phones_json(&self) -> serde_json::Value {
        json!(self
            .phones
            .iter()
            .map(
                |p| json!({ "hash": p.hash, "name": p.name, "device": p.device, "vault": p.vault })
            )
            .collect::<Vec<_>>())
    }

    /// Phones read back from [`Lan::phones_json`].
    pub fn load_phones(&mut self, v: &serde_json::Value) {
        self.phones = v
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|p| {
                        Some(Phone {
                            hash: p["hash"].as_str()?.to_string(),
                            name: p["name"].as_str().unwrap_or("Phone").to_string(),
                            device: p["device"].as_str().map(str::to_string),
                            vault: p["vault"].as_bool().unwrap_or(false),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
    }

    /// Is `bearer` a connected phone's token (for `/nlp/…`, which the listener forwards)?
    pub fn authorized(&self, bearer: Option<&str>) -> bool {
        bearer.is_some_and(|t| {
            let h = hash(t);
            self.phones.iter().any(|p| p.hash == h)
        })
    }

    /// Remove a phone (Settings → Your devices → Remove): its token stops working.
    pub fn remove_phone(&mut self, hash: &str) {
        self.phones.retain(|p| p.hash != hash);
        self.dirty = true;
    }
}

fn hash(token: &str) -> String {
    Sha256::digest(token.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn random_bytes<const N: usize>() -> [u8; N] {
    let mut b = [0u8; N];
    getrandom::fill(&mut b).expect("random bytes");
    b
}

/// The parts of a relative sync path (the server's `syncPath`), or a 400.
pub fn sync_path(path: Option<&str>, allow_empty: bool) -> Result<Vec<String>, Reply> {
    let path = path.unwrap_or("");
    if path.is_empty() {
        return if allow_empty {
            Ok(vec![])
        } else {
            Err(Reply::fail(400, "A path is needed."))
        };
    }
    let parts: Vec<String> = path.split('/').map(str::to_string).collect();
    let bad = |p: &String| {
        p.is_empty()
            || p == "."
            || p == ".."
            || !p
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
    };
    if parts.len() > 8 || parts.iter().any(bad) {
        return Err(Reply::fail(400, "Not a valid sync path."));
    }
    Ok(parts)
}

/// What a write is allowed to change in a phone's rights.
#[derive(Debug, PartialEq, Default)]
pub struct Allowed {
    pub claim: Option<String>,
    pub made_vault: bool,
}

/// Why phone `rights` may not write (PUT) or remove (DELETE) `parts` (the server's
/// `syncWriteProblem`).
pub fn write_problem(
    parts: &[String],
    put: bool,
    rights: &Phone,
    vault_exists: bool,
) -> Result<Allowed, String> {
    let at = |i: usize| parts.get(i).map(String::as_str);
    if at(0) == Some("vuurtoren") && at(1) == Some("devices") && parts.len() >= 4 {
        let device = parts[2].clone();
        if rights.device.as_deref() == Some(device.as_str()) {
            return Ok(Allowed::default());
        }
        if rights.device.is_none() && put {
            return Ok(Allowed {
                claim: Some(device),
                made_vault: false,
            });
        }
        return Err("This phone may only change its own folder.".into());
    }
    if at(0) == Some("vuurtoren") && at(1) == Some("blobs") && parts.len() == 3 && put {
        return Ok(Allowed::default());
    }
    if at(0) == Some("vuurtoren") && at(1) == Some("vault.json") && parts.len() == 2 && put {
        if !vault_exists {
            return Ok(Allowed {
                claim: None,
                made_vault: true,
            });
        }
        if rights.vault {
            return Ok(Allowed::default());
        }
        return Err("This phone may not change the passphrase or recovery key.".into());
    }
    Err("A phone may not change this file.".into())
}

impl Lan {
    pub fn new(root: &Path) -> Self {
        Lan {
            root: root.to_path_buf(),
            phones: vec![],
            code: None,
            dirty: false,
        }
    }

    fn file(&self, parts: &[String]) -> PathBuf {
        parts.iter().fold(self.root.clone(), |p, part| p.join(part))
    }

    /// A new pairing code for a phone, `ABCDE-FGHJK`, valid for ten minutes from `now` (s).
    /// `handover` (the sync place and key, from the app) goes to the phone that uses the code.
    pub fn new_code_with(&mut self, now: u64, handover: Option<serde_json::Value>) -> String {
        let code = self.new_code(now);
        if let Some(c) = self.code.as_mut() {
            c.handover = handover;
        }
        code
    }

    /// A new pairing code without a handover.
    pub fn new_code(&mut self, now: u64) -> String {
        let bytes = random_bytes::<10>();
        let chars: String = bytes
            .iter()
            .map(|b| CODE_SYMBOLS[*b as usize % CODE_SYMBOLS.len()] as char)
            .collect();
        let code = format!("{}-{}", &chars[..5], &chars[5..]);
        self.code = Some(Code {
            code: code.clone(),
            expires: now + CODE_SECONDS,
            tries: 0,
            handover: None,
        });
        code
    }

    fn pair(&mut self, body: &[u8], now: u64) -> Reply {
        let v: serde_json::Value = serde_json::from_slice(body).unwrap_or_default();
        let given = v["code"]
            .as_str()
            .unwrap_or("")
            .replace('-', "")
            .to_uppercase();
        let name = v["name"]
            .as_str()
            .unwrap_or("Phone")
            .chars()
            .take(80)
            .collect::<String>();
        let Some(code) = self.code.as_mut() else {
            return Reply::fail(401, "Show a new code on the computer and scan it again.");
        };
        if now > code.expires || code.tries >= CODE_TRIES {
            self.code = None;
            return Reply::fail(
                401,
                "This code has run out. Show a new one on the computer.",
            );
        }
        if given != code.code.replace('-', "") {
            code.tries += 1;
            return Reply::fail(401, "That code is not the one on the computer.");
        }
        let handover = self.code.take().and_then(|c| c.handover);
        let token: String = random_bytes::<32>()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        self.phones.push(Phone {
            hash: hash(&token),
            name: name.clone(),
            device: None,
            vault: false,
        });
        let mut answer = json!({ "ok": true, "token": token, "label": name });
        if let Some(h) = handover {
            answer["handover"] = h;
        }
        self.dirty = true;
        Reply::json(200, answer)
    }

    /// One request. `bearer` is the token from `Authorization: Bearer …`, `now` in seconds.
    pub fn dispatch(
        &mut self,
        method: &str,
        path: &str,
        query: &HashMap<String, String>,
        bearer: Option<&str>,
        body: &[u8],
        now: u64,
    ) -> Reply {
        if path == "/api/health" && method == "GET" {
            return Reply::json(200, json!({ "ok": true, "service": "vuurtoren-desktop" }));
        }
        if path == "/api/sync/pair" && method == "POST" {
            return self.pair(body, now);
        }
        if !path.starts_with("/api/sync/") {
            return Reply::fail(404, "Not found.");
        }
        let Some(phone) = bearer.and_then(|t| {
            let h = hash(t);
            self.phones.iter().position(|p| p.hash == h)
        }) else {
            return Reply::fail(401, "This phone is not connected to this computer.");
        };
        match (path, method) {
            ("/api/sync/list", "GET") => {
                let parts = match sync_path(query.get("dir").map(String::as_str), true) {
                    Ok(p) => p,
                    Err(r) => return r,
                };
                let mut names: Vec<String> = fs::read_dir(self.file(&parts))
                    .map(|rd| {
                        rd.filter_map(Result::ok)
                            .map(|e| e.file_name().to_string_lossy().into_owned())
                            .filter(|n| !n.starts_with(TMP))
                            .collect()
                    })
                    .unwrap_or_default();
                names.sort();
                Reply::json(200, json!({ "ok": true, "names": names }))
            }
            ("/api/sync/file", m) => {
                let parts = match sync_path(query.get("path").map(String::as_str), false) {
                    Ok(p) => p,
                    Err(r) => return r,
                };
                let target = self.file(&parts);
                match m {
                    "GET" => match fs::read(&target) {
                        Ok(bytes) if target.is_file() => Reply {
                            status: 200,
                            content_type: "application/octet-stream",
                            body: bytes,
                        },
                        _ => Reply::fail(404, "No such file."),
                    },
                    "PUT" | "DELETE" => {
                        let put = m == "PUT";
                        let vault_exists = self.root.join("vuurtoren/vault.json").is_file();
                        let allowed =
                            match write_problem(&parts, put, &self.phones[phone], vault_exists) {
                                Ok(a) => a,
                                Err(problem) => return Reply::fail(403, &problem),
                            };
                        if put && body.len() > MAX_FILE {
                            return Reply::fail(413, "This file is too big to sync.");
                        }
                        let done = if put {
                            write_atomic(&target, body)
                        } else {
                            match fs::remove_file(&target) {
                                Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
                                _ => Ok(()),
                            }
                        };
                        if let Err(e) = done {
                            return Reply::fail(500, &format!("Could not save the file: {e}"));
                        }
                        let p = &mut self.phones[phone];
                        if let Some(device) = allowed.claim {
                            p.device = Some(device);
                            self.dirty = true;
                        }
                        if allowed.made_vault {
                            p.vault = true;
                            self.dirty = true;
                        }
                        Reply::json(200, json!({ "ok": true }))
                    }
                    _ => Reply::fail(404, "Not found."),
                }
            }
            _ => Reply::fail(404, "Not found."),
        }
    }
}

/// Write through a temporary file in the same folder, so a crash never leaves half a file.
fn write_atomic(target: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let dir = target.parent().unwrap_or(Path::new("."));
    fs::create_dir_all(dir)?;
    let tmp = dir.join(format!(
        "{TMP}{}",
        random_bytes::<8>()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    ));
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, target)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn q(k: &str, v: &str) -> HashMap<String, String> {
        HashMap::from([(k.to_string(), v.to_string())])
    }

    fn paired(lan: &mut Lan) -> String {
        let code = lan.new_code(1000);
        let r = lan.dispatch(
            "POST",
            "/api/sync/pair",
            &HashMap::new(),
            None,
            json!({ "code": code, "name": "Pixel" })
                .to_string()
                .as_bytes(),
            1001,
        );
        assert_eq!(r.status, 200);
        let v: serde_json::Value = serde_json::from_slice(&r.body).unwrap();
        v["token"].as_str().unwrap().to_string()
    }

    #[test]
    fn paths_are_checked_like_the_server() {
        assert!(sync_path(Some("vuurtoren/devices/abc/ev.kan"), false).is_ok());
        assert_eq!(sync_path(Some(""), true).unwrap(), Vec::<String>::new());
        for bad in ["../x", "a//b", "vuurtoren/./x", "a b", "a/b/c/d/e/f/g/h/i"] {
            assert_eq!(
                sync_path(Some(bad), false).unwrap_err().status,
                400,
                "{bad}"
            );
        }
    }

    #[test]
    fn a_code_pairs_once_and_runs_out() {
        let dir = tempfile::tempdir().unwrap();
        let mut lan = Lan::new(dir.path());
        let token = paired(&mut lan);
        assert_eq!(token.len(), 64);
        assert_eq!(lan.phones.len(), 1);
        assert_ne!(lan.phones[0].hash, token, "only the hash is kept");
        // Used: the same code no longer works.
        let again = lan.dispatch("POST", "/api/sync/pair", &HashMap::new(), None, b"{}", 1002);
        assert_eq!(again.status, 401);
        // Expired, and too many wrong tries.
        let code = lan.new_code(0);
        let late = json!({ "code": code }).to_string();
        let r = lan.dispatch(
            "POST",
            "/api/sync/pair",
            &HashMap::new(),
            None,
            late.as_bytes(),
            601,
        );
        assert_eq!(r.status, 401);
        lan.new_code(0);
        for _ in 0..CODE_TRIES {
            lan.dispatch(
                "POST",
                "/api/sync/pair",
                &HashMap::new(),
                None,
                b"{\"code\":\"X\"}",
                1,
            );
        }
        assert!(lan.code.as_ref().is_none_or(|c| c.tries >= CODE_TRIES));
    }

    #[test]
    fn a_phone_writes_its_own_folder_images_and_the_first_vault_only() {
        let dir = tempfile::tempdir().unwrap();
        let mut lan = Lan::new(dir.path());
        let t = paired(&mut lan);
        let tok = Some(t.as_str());
        let put = |lan: &mut Lan, path: &str| {
            lan.dispatch("PUT", "/api/sync/file", &q("path", path), tok, b"x", 5)
                .status
        };
        assert_eq!(put(&mut lan, "vuurtoren/vault.json"), 200);
        assert_eq!(put(&mut lan, "vuurtoren/devices/phone1/seg-1.kan"), 200);
        assert_eq!(lan.phones[0].device.as_deref(), Some("phone1"));
        assert_eq!(put(&mut lan, "vuurtoren/devices/laptop/seg-1.kan"), 403);
        assert_eq!(put(&mut lan, "vuurtoren/blobs/abc"), 200);
        assert_eq!(put(&mut lan, "elsewhere.txt"), 403);
        // Read back, list, remove.
        let got = lan.dispatch(
            "GET",
            "/api/sync/file",
            &q("path", "vuurtoren/devices/phone1/seg-1.kan"),
            tok,
            b"",
            5,
        );
        assert_eq!((got.status, got.body.as_slice()), (200, b"x".as_slice()));
        let list = lan.dispatch(
            "GET",
            "/api/sync/list",
            &q("dir", "vuurtoren/devices"),
            tok,
            b"",
            5,
        );
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&list.body).unwrap()["names"],
            json!(["phone1"])
        );
        let del = lan.dispatch(
            "DELETE",
            "/api/sync/file",
            &q("path", "vuurtoren/devices/phone1/seg-1.kan"),
            tok,
            b"",
            5,
        );
        assert_eq!(del.status, 200);
        assert!(!dir
            .path()
            .join("vuurtoren/devices/phone1/seg-1.kan")
            .exists());
    }

    #[test]
    fn nothing_without_a_paired_token() {
        let dir = tempfile::tempdir().unwrap();
        let mut lan = Lan::new(dir.path());
        let r = lan.dispatch(
            "GET",
            "/api/sync/list",
            &HashMap::new(),
            Some("nope"),
            b"",
            1,
        );
        assert_eq!(r.status, 401);
        let h = lan.dispatch("GET", "/api/health", &HashMap::new(), None, b"", 1);
        assert_eq!(h.status, 200);
    }

    #[test]
    fn the_phone_gets_the_handover_once_and_phones_are_saved() {
        let dir = tempfile::tempdir().unwrap();
        let mut lan = Lan::new(dir.path());
        let code = lan.new_code_with(10, Some(json!({ "place": "lan", "key": "AAAA" })));
        let r = lan.dispatch(
            "POST",
            "/api/sync/pair",
            &HashMap::new(),
            None,
            json!({ "code": code }).to_string().as_bytes(),
            11,
        );
        let v: serde_json::Value = serde_json::from_slice(&r.body).unwrap();
        assert_eq!(v["handover"]["key"], "AAAA");
        assert!(lan.take_dirty());
        assert!(!lan.take_dirty());
        // Saved and read back; removing a phone stops its token.
        let mut again = Lan::new(dir.path());
        again.load_phones(&lan.phones_json());
        assert_eq!(again.phones, lan.phones);
        let token = v["token"].as_str().unwrap();
        let hash = again.phones[0].hash.clone();
        again.remove_phone(&hash);
        let r = again.dispatch(
            "GET",
            "/api/sync/list",
            &HashMap::new(),
            Some(token),
            b"",
            12,
        );
        assert_eq!(r.status, 401);
    }
}
