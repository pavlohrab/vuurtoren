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
//! `None` and the page asks the server as before. `download` puts it there: the archive of the
//! version in `packs.json` (the language server's manifest, built in), from the connected
//! Vuurtoren server (`<server>/nlp/packs/<archive>`, with the device's sync token) or else the
//! data host (data.vuurtoren.app), resumed where an earlier try stopped, and checked by size and SHA-256
//! before it replaces anything. The APK carries no pack: it stays small.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use sha2::{Digest, Sha256};

/// The language server's pack manifest: versions, sizes and checksums of the archives.
const MANIFEST: &str = include_str!("../../../../server/nlp/src/vuurtoren_nlp/packs.json");
/// Where the published packs are (`packs-<version>/<name>-<version>.tar.gz`): the data host,
/// or another address given when the app is built (`VUURTOREN_DATA_URL`).
const DATA_HOST: &str = match option_env!("VUURTOREN_DATA_URL") {
    Some(url) => url,
    None => "https://data.vuurtoren.app",
};
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

    /// The archive's address on the data host.
    pub fn url(&self) -> String {
        format!("{DATA_HOST}/packs-{v}/{NAME}-{v}.tar.gz", v = self.version)
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

/// Where an unfinished download waits, so the next try goes on where it stopped.
pub fn part_in(app_data: &Path, pack: &Pack) -> PathBuf {
    app_data
        .join("packs")
        .join(format!("{NAME}-{}.tar.gz.part", pack.version))
}

/// One place to fetch the archive from: the connected Vuurtoren server
/// (`<server>/nlp/packs/<archive>` with the device's sync token), or the data host.
pub struct Source {
    pub url: String,
    pub token: Option<String>,
    /// "server" or "release": said back to the page.
    pub name: &'static str,
}

impl Pack {
    /// The archive's file name (`dictionary-nl-<version>.tar.gz`).
    pub fn file_name(&self) -> String {
        format!("{NAME}-{}.tar.gz", self.version)
    }

    /// The server's copy of the archive, under its language server (`…/nlp`).
    pub fn server_url(&self, nlp: &str) -> String {
        format!("{}/packs/{}", nlp.trim_end_matches('/'), self.file_name())
    }
}

/// Download the archive into `part`, going on from the bytes already there (a Range request;
/// a source that ignores it starts again). `received` follows the bytes on disk.
pub(crate) async fn fetch_into(
    client: &reqwest::Client,
    source: &Source,
    part: &Path,
    size: u64,
    received: &AtomicU64,
) -> Result<(), String> {
    use std::io::Write as _;
    let mut have = std::fs::metadata(part).map_or(0, |m| m.len());
    if have > size {
        let _ = std::fs::remove_file(part);
        have = 0;
    }
    received.store(have, Ordering::Relaxed);
    if have == size {
        return Ok(());
    }
    let mut req = client.get(&source.url);
    if let Some(token) = &source.token {
        req = req.bearer_auth(token);
    }
    if have > 0 {
        req = req.header(reqwest::header::RANGE, format!("bytes={have}-"));
    }
    let mut res = req
        .send()
        .await
        .map_err(|e| format!("Cannot reach {}: {e}", source.name))?;
    let status = res.status();
    if !status.is_success() {
        return Err(format!("The download failed ({status})."));
    }
    let resume = have > 0 && status == reqwest::StatusCode::PARTIAL_CONTENT;
    let mut file = if resume {
        std::fs::OpenOptions::new().append(true).open(part)
    } else {
        have = 0;
        std::fs::File::create(part)
    }
    .map_err(|e| e.to_string())?;
    let mut got = have;
    received.store(got, Ordering::Relaxed);
    while let Some(chunk) = res
        .chunk()
        .await
        .map_err(|e| format!("The download stopped ({e}). Try again to go on from here."))?
    {
        got += chunk.len() as u64;
        if got > size {
            drop(file);
            let _ = std::fs::remove_file(part);
            return Err("The download is larger than this app expects.".into());
        }
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        received.store(got, Ordering::Relaxed);
    }
    if got != size {
        return Err("The download stopped early. Try again to go on from here.".into());
    }
    Ok(())
}

/// Fetch the archive from the first source that has it (resuming a part already on disk),
/// check its size and SHA-256 against `packs.json` and put the dictionary in place. Says which
/// source it came from. A damaged download is removed, so the next try starts clean.
pub async fn download(
    client: &reqwest::Client,
    sources: &[Source],
    pack: &Pack,
    app_data: &Path,
    received: &AtomicU64,
) -> Result<&'static str, String> {
    let part = part_in(app_data, pack);
    std::fs::create_dir_all(part.parent().ok_or("No folder for the dictionary.")?)
        .map_err(|e| e.to_string())?;
    let mut last = String::from("No place to download the dictionary from.");
    for source in sources {
        if let Err(e) = fetch_into(client, source, &part, pack.size, received).await {
            last = e;
            continue;
        }
        let bytes = std::fs::read(&part).map_err(|e| e.to_string())?;
        let res = pack.install(&bytes, &path_in(app_data));
        let _ = std::fs::remove_file(&part);
        return res.map(|()| source.name);
    }
    Err(last)
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

    /// A small HTTP server for one file at `/pack`: Range requests get the rest (206); the first
    /// full answer stops halfway (a dropped connection); any other path is 404.
    fn serve(body: Vec<u8>) -> String {
        use std::io::{Read as _, Write as _};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let mut cut = true;
            for stream in listener.incoming() {
                let mut stream = stream.unwrap();
                let mut req = Vec::new();
                let mut buf = [0u8; 1024];
                while !req.windows(4).any(|w| w == b"\r\n\r\n") {
                    let n = stream.read(&mut buf).unwrap();
                    if n == 0 {
                        break;
                    }
                    req.extend_from_slice(&buf[..n]);
                }
                let req = String::from_utf8_lossy(&req).to_lowercase();
                if !req.starts_with("get /pack ") {
                    let _ = stream.write_all(
                        b"HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\nconnection: close\r\n\r\n",
                    );
                    continue;
                }
                let from = req
                    .lines()
                    .find_map(|l| l.strip_prefix("range: bytes="))
                    .and_then(|r| r.trim_end_matches('-').parse::<usize>().ok());
                let head = match from {
                    Some(from) => format!(
                        "HTTP/1.1 206 Partial Content\r\ncontent-length: {}\r\ncontent-range: bytes {from}-{}/{}\r\nconnection: close\r\n\r\n",
                        body.len() - from,
                        body.len() - 1,
                        body.len()
                    ),
                    None => format!(
                        "HTTP/1.1 200 OK\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                        body.len()
                    ),
                };
                let _ = stream.write_all(head.as_bytes());
                let rest = &body[from.unwrap_or(0)..];
                if from.is_none() && cut {
                    cut = false;
                    let _ = stream.write_all(&rest[..rest.len() / 2]);
                } else {
                    let _ = stream.write_all(rest);
                }
            }
        });
        format!("http://{addr}")
    }

    #[test]
    fn a_download_falls_back_resumes_and_is_checked() {
        let dir = tempfile::tempdir().unwrap();
        let (archive, pack) = archive(dir.path());
        let base = serve(archive.clone());
        let app = dir.path().join("app");
        let sources = [
            Source {
                url: format!("{base}/nlp/packs/none"),
                token: Some("t".into()),
                name: "server",
            },
            Source {
                url: format!("{base}/pack"),
                token: None,
                name: "release",
            },
        ];
        let client = crate::http_builder().build().expect("an HTTP client");
        let received = AtomicU64::new(0);
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        // The server has no copy; the release breaks off halfway: part of it waits on disk.
        assert!(rt
            .block_on(download(&client, &sources, &pack, &app, &received))
            .is_err());
        let part = std::fs::metadata(part_in(&app, &pack)).unwrap().len();
        assert!(part > 0 && part < pack.size);
        // The next try asks for the rest only, checks the whole and puts it in place.
        assert_eq!(
            rt.block_on(download(&client, &sources, &pack, &app, &received)),
            Ok("release")
        );
        assert_eq!(received.load(Ordering::Relaxed), pack.size);
        assert!(!part_in(&app, &pack).exists());
        assert!(open(&path_in(&app)).is_some());
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
