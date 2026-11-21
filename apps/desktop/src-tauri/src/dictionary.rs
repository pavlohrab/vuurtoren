//! The `dictionary-nl` pack read on the device (phones): the same SQLite file the language
//! server reads (`server/nlp/src/vuurtoren_nlp/dictionary.py`), so a word gets its meaning
//! without a server. The answer has the shape of the language server's `POST /gloss`:
//! `{ word: [{ pos, article, glosses }] }`.
//!
//! The lookup is the server's first two steps: the word's own entries, else the entries of the
//! lemma it is a form of (`fietsen` → `fiets`). Compounds and derivations (the server's
//! analysis of unknown words) are not done here: such a word comes back with no entries.
//!
//! The file lives at `<app data>/packs/dictionary-nl.sqlite`. Without it, `gloss` answers
//! `None` and the page asks the server as before. `install` puts it there: the archive of the
//! version in `packs.json` (the language server's manifest, built in), from the public packs
//! release, checked by size and SHA-256 before it replaces anything.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use sha2::{Digest, Sha256};

/// The language server's pack manifest: versions, sizes and checksums of the archives.
const MANIFEST: &str = include_str!("../../../../server/nlp/src/vuurtoren_nlp/packs.json");
/// Where the published packs are (`packs-<version>/<name>-<version>.tar.gz`).
const RELEASES: &str = "https://github.com/pavlohrab/Vuurtoren/releases/download";
const NAME: &str = "dictionary-nl";

/// The dictionary pack this build wants.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Pack {
    pub version: String,
    pub sha256: String,
    pub size: u64,
}

impl Pack {
    /// The pack from the built-in manifest.
    pub fn wanted() -> Option<Pack> {
        let manifest: serde_json::Value = serde_json::from_str(MANIFEST).ok()?;
        let pack = manifest.pointer(&format!("/packs/{NAME}"))?;
        Some(Pack {
            version: pack.get("version")?.as_str()?.into(),
            sha256: pack.get("sha256")?.as_str()?.into(),
            size: pack.get("size")?.as_u64()?,
        })
    }

    /// The archive's address in the public packs release.
    pub fn url(&self) -> String {
        format!("{RELEASES}/packs-{v}/{NAME}-{v}.tar.gz", v = self.version)
    }

    /// Check the archive (size, SHA-256), unpack its file next to `dest` and move it into place.
    pub fn install(&self, archive: &[u8], dest: &Path) -> Result<(), String> {
        if archive.len() as u64 != self.size {
            return Err(format!(
                "The download has {} bytes, not {}.",
                archive.len(),
                self.size
            ));
        }
        let sum: String = Sha256::digest(archive)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        if sum != self.sha256 {
            return Err("The download is damaged (its checksum does not match).".into());
        }
        let dir = dest.parent().ok_or("No folder for the dictionary.")?;
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let tmp = dest.with_extension("sqlite.part");
        let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(archive));
        let mut found = false;
        for entry in tar.entries().map_err(|e| e.to_string())? {
            let mut entry = entry.map_err(|e| e.to_string())?;
            if !entry.header().entry_type().is_file() {
                continue;
            }
            let mut out = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
            found = true;
            break;
        }
        if !found || open(&tmp).is_none() {
            let _ = std::fs::remove_file(&tmp);
            return Err("The download holds no dictionary.".into());
        }
        std::fs::rename(&tmp, dest).map_err(|e| e.to_string())
    }
}

/// The pack's file name inside the app's `packs` folder.
pub const FILE: &str = "dictionary-nl.sqlite";
/// The archive the app carries (an Android asset), copied next to the pack at first start by
/// `MainActivity.kt` and unpacked by `unpack_bundled`.
pub const BUNDLED: &str = "dictionary-nl.bundled.tar.gz";

/// Where the copied archive waits to be unpacked.
pub fn bundled_in(app_data: &Path) -> PathBuf {
    app_data.join("packs").join(BUNDLED)
}

/// Unpack the archive the app carries into place, checked like a download, and remove it
/// (also when it is damaged, so the download takes over). `Ok(false)` when there is nothing to
/// do: no archive, or the pack is there already.
pub fn unpack_bundled(app_data: &Path) -> Result<bool, String> {
    let archive = bundled_in(app_data);
    if !archive.exists() {
        return Ok(false);
    }
    let dest = path_in(app_data);
    let res = if open(&dest).is_some() {
        Ok(false)
    } else {
        let pack = Pack::wanted().ok_or("This build names no dictionary pack.")?;
        std::fs::read(&archive)
            .map_err(|e| e.to_string())
            .and_then(|bytes| pack.install(&bytes, &dest))
            .map(|()| true)
    };
    let _ = std::fs::remove_file(&archive);
    res
}

/// At most this many words per call (the server's limit).
const MAX_WORDS: usize = 2000;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Entry {
    pub pos: String,
    pub article: Option<String>,
    pub glosses: Vec<String>,
}

/// Where the pack goes on this device.
pub fn path_in(app_data: &Path) -> PathBuf {
    app_data.join("packs").join(FILE)
}

/// Open the pack read-only; `None` when it is not there (or not a dictionary).
pub fn open(path: &Path) -> Option<Connection> {
    if !path.is_file() {
        return None;
    }
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()?;
    // A file that is not the dictionary (a broken download) counts as no pack.
    conn.prepare("SELECT pos, article, glosses FROM entries LIMIT 1")
        .ok()?;
    Some(conn)
}

fn rows(conn: &Connection, sql: &str, key: &str) -> rusqlite::Result<Vec<Entry>> {
    let mut stmt = conn.prepare_cached(sql)?;
    let found = stmt.query_map([key], |r| {
        let glosses: String = r.get(2)?;
        Ok(Entry {
            pos: r.get(0)?,
            article: r.get(1)?,
            glosses: serde_json::from_str(&glosses).unwrap_or_default(),
        })
    })?;
    found.collect()
}

/// Entries per word (case-insensitive); unknown words map to an empty list.
pub fn lookup(
    conn: &Connection,
    words: &[String],
) -> rusqlite::Result<HashMap<String, Vec<Entry>>> {
    let mut out = HashMap::new();
    for word in words.iter().take(MAX_WORDS) {
        if out.contains_key(word) {
            continue;
        }
        let key = word.trim().to_lowercase();
        let mut entries = rows(
            conn,
            "SELECT pos, article, glosses FROM entries WHERE lower(word) = ?1 ORDER BY id",
            &key,
        )?;
        if entries.is_empty() {
            entries = rows(
                conn,
                "SELECT e.pos, e.article, e.glosses FROM entries e WHERE lower(e.word) IN \
                 (SELECT lower(lemma) FROM forms WHERE lower(form) = ?1) ORDER BY e.id",
                &key,
            )?;
        }
        out.insert(word.clone(), entries);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A tiny dictionary with the server's schema.
    fn sample(dir: &Path) -> PathBuf {
        let path = dir.join(FILE);
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE entries (id INTEGER PRIMARY KEY, word TEXT NOT NULL, pos TEXT NOT NULL,
               article TEXT, gender TEXT, glosses TEXT NOT NULL, forms TEXT NOT NULL, ipa TEXT);
             CREATE TABLE forms (form TEXT NOT NULL, lemma TEXT NOT NULL, pos TEXT NOT NULL);
             INSERT INTO entries(word, pos, article, glosses, forms)
               VALUES ('fiets', 'noun', 'de', '[\"bicycle\"]', '[\"fietsen\"]'),
                      ('fietsen', 'verb', NULL, '[\"to cycle\"]', '[]'),
                      ('huis', 'noun', 'het', '[\"house\", \"home\"]', '[\"huizen\"]');
             INSERT INTO forms VALUES ('huizen', 'huis', 'noun');",
        )
        .unwrap();
        path
    }

    #[test]
    fn own_entries_then_the_lemma_of_a_form() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(&sample(dir.path())).unwrap();
        let words: Vec<String> = ["Huis", "huizen", "fietsen", "onbekend"]
            .iter()
            .map(|w| w.to_string())
            .collect();
        let found = lookup(&conn, &words).unwrap();
        assert_eq!(
            found["Huis"],
            vec![Entry {
                pos: "noun".into(),
                article: Some("het".into()),
                glosses: vec!["house".into(), "home".into()],
            }]
        );
        assert_eq!(found["huizen"], found["Huis"]);
        // Its own entry first: the verb, not the noun it is also a form of.
        assert_eq!(found["fietsen"][0].pos, "verb");
        assert!(found["onbekend"].is_empty());
    }

    /// The sample dictionary as a pack archive, with its manifest entry.
    fn archive(dir: &Path) -> (Vec<u8>, Pack) {
        let db = std::fs::read(sample(dir)).unwrap();
        let mut tar = tar::Builder::new(Vec::new());
        let mut header = tar::Header::new_gnu();
        header.set_size(db.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        tar.append_data(&mut header, FILE, db.as_slice()).unwrap();
        let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        std::io::Write::write_all(&mut gz, &tar.into_inner().unwrap()).unwrap();
        let archive = gz.finish().unwrap();
        let sum: String = Sha256::digest(&archive)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        let pack = Pack {
            version: "1".into(),
            sha256: sum,
            size: archive.len() as u64,
        };
        (archive, pack)
    }

    #[test]
    fn installs_a_checked_archive_and_refuses_a_damaged_one() {
        let dir = tempfile::tempdir().unwrap();
        let (archive, pack) = archive(dir.path());
        let dest = path_in(&dir.path().join("app"));
        let mut damaged = archive.clone();
        damaged[20] ^= 1;
        assert!(pack.install(&damaged, &dest).is_err());
        assert!(!dest.exists());
        pack.install(&archive, &dest).unwrap();
        let conn = open(&dest).unwrap();
        assert_eq!(
            lookup(&conn, &["huis".into()]).unwrap()["huis"][0].glosses[0],
            "house"
        );
    }

    #[test]
    fn the_bundled_archive_is_unpacked_once_and_removed() {
        let dir = tempfile::tempdir().unwrap();
        let app = dir.path().join("app");
        // Nothing carried: nothing to do.
        assert_eq!(unpack_bundled(&app), Ok(false));
        // A damaged archive is refused and removed, so the download takes over.
        std::fs::create_dir_all(app.join("packs")).unwrap();
        std::fs::write(bundled_in(&app), b"not a pack").unwrap();
        assert!(unpack_bundled(&app).is_err());
        assert!(!bundled_in(&app).exists());
        assert!(open(&path_in(&app)).is_none());
        // With the pack in place, a carried archive is just removed.
        std::fs::copy(sample(dir.path()), path_in(&app)).unwrap();
        std::fs::write(bundled_in(&app), b"old").unwrap();
        assert_eq!(unpack_bundled(&app), Ok(false));
        assert!(!bundled_in(&app).exists());
    }

    #[test]
    fn the_wanted_pack_comes_from_the_manifest() {
        let pack = Pack::wanted().unwrap();
        assert_eq!(pack.sha256.len(), 64);
        assert!(pack.url().ends_with(&format!(
            "/packs-{v}/dictionary-nl-{v}.tar.gz",
            v = pack.version
        )));
    }

    #[test]
    fn no_pack_or_another_file_is_no_dictionary() {
        let dir = tempfile::tempdir().unwrap();
        assert!(open(&dir.path().join(FILE)).is_none());
        let other = dir.path().join("other.sqlite");
        Connection::open(&other)
            .unwrap()
            .execute_batch("CREATE TABLE t (x)")
            .unwrap();
        assert!(open(&other).is_none());
        assert_eq!(
            path_in(Path::new("/data")),
            Path::new("/data").join("packs").join(FILE)
        );
    }
}
