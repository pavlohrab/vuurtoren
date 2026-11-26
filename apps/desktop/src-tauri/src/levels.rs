//! The `levels-nl` pack on the device: a rough CEFR level per Dutch word ("about A2"), from
//! NT2Lex. CC BY-NC-SA 4.0, so it is a file of its own, never mixed into the dictionary (CC BY-SA);
//! it is joined with the dictionary's answer here, as the language server does in `/entry`
//! (`server/nlp/src/vuurtoren_nlp/levels.py`, same file, same rule).
//!
//! The file lives at `<app data>/packs/levels-nl.tsv.gz`: `word<TAB>pos<TAB>level` lines, the
//! pos the dictionary's (noun, verb, adj…). It is small (about 70 KB), fetched from the data host
//! like the dictionary, checked by size and SHA-256 from `packs.json`.

use std::collections::HashMap;
use std::io::Read as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicU64;
use std::sync::{Mutex, OnceLock};

use sha2::{Digest, Sha256};

use crate::dictionary::{fetch_into, Pack, Source};

const NAME: &str = "levels-nl";
pub const FILE: &str = "levels-nl.tsv.gz";
const ORDER: [&str; 5] = ["A1", "A2", "B1", "B2", "C1"];

/// Where the file goes on this device.
pub fn path_in(app_data: &Path) -> PathBuf {
    app_data.join("packs").join(FILE)
}

/// The levels pack this build wants, from the built-in manifest; None if it names none.
pub fn wanted() -> Option<Pack> {
    Pack::wanted_named(NAME)
}

type Table = HashMap<String, HashMap<String, String>>;

/// Read the file's lines into word → pos → level.
fn parse(gz: &[u8]) -> Option<Table> {
    let mut text = String::new();
    flate2::read::GzDecoder::new(gz)
        .read_to_string(&mut text)
        .ok()?;
    let mut out: Table = HashMap::new();
    for line in text.lines() {
        if line.starts_with('#') || line.trim().is_empty() {
            continue;
        }
        let mut cols = line.split('\t');
        let (Some(word), Some(pos), Some(level)) = (cols.next(), cols.next(), cols.next()) else {
            continue;
        };
        out.entry(word.to_string())
            .or_default()
            .insert(pos.to_string(), level.to_string());
    }
    (!out.is_empty()).then_some(out)
}

/// The table, read once from `path` (None while the file isn't there).
fn table(path: &Path) -> Option<&'static Table> {
    static CACHE: OnceLock<Mutex<Option<&'static Table>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(None));
    let mut held = cache.lock().ok()?;
    if let Some(t) = *held {
        return Some(t);
    }
    let t: &'static Table = Box::leak(Box::new(parse(&std::fs::read(path).ok()?)?));
    *held = Some(t);
    Some(t)
}

/// The word's rough level: for this part of speech, else the lowest of its entries.
fn level_in(table: &Table, word: &str, pos: Option<&str>) -> Option<String> {
    let by_pos = table.get(&word.trim().to_lowercase())?;
    if let Some(level) = pos.and_then(|p| by_pos.get(p)) {
        return Some(level.clone());
    }
    by_pos
        .values()
        .min_by_key(|l| ORDER.iter().position(|o| o == l).unwrap_or(ORDER.len()))
        .cloned()
}

/// Add `level` to each entry of a dictionary `/entry` answer, when the file is there.
pub fn add_levels(app_data: &Path, answer: &mut serde_json::Value) {
    let Some(table) = table(&path_in(app_data)) else {
        return;
    };
    let word = answer
        .get("word")
        .and_then(|w| w.as_str())
        .unwrap_or_default()
        .to_string();
    let Some(entries) = answer.get_mut("entries").and_then(|e| e.as_array_mut()) else {
        return;
    };
    for e in entries {
        let pos = e.get("pos").and_then(|p| p.as_str()).map(str::to_string);
        if let Some(level) = level_in(table, &word, pos.as_deref()) {
            e["level"] = serde_json::json!(level);
        }
    }
}

/// Check the archive (size, SHA-256) and put its one file in place.
pub fn install(pack: &Pack, archive: &[u8], dest: &Path) -> Result<(), String> {
    if archive.len() as u64 != pack.size {
        return Err("The levels download has the wrong size.".into());
    }
    let sum: String = Sha256::digest(archive)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    if sum != pack.sha256 {
        return Err("The levels download is damaged.".into());
    }
    let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(archive));
    for entry in tar.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        if !entry.header().entry_type().is_file() {
            continue;
        }
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        if parse(&bytes).is_none() {
            return Err("The levels download holds no levels.".into());
        }
        std::fs::create_dir_all(dest.parent().ok_or("No folder for the levels.")?)
            .map_err(|e| e.to_string())?;
        let tmp = dest.with_extension("part");
        std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
        return std::fs::rename(&tmp, dest).map_err(|e| e.to_string());
    }
    Err("The levels download holds no levels.".into())
}

/// True the first time it's called in this run: one background try per app start.
pub fn first_try() -> bool {
    use std::sync::atomic::{AtomicBool, Ordering};
    static TRIED: AtomicBool = AtomicBool::new(false);
    !TRIED.swap(true, Ordering::SeqCst)
}

/// Fetch the pack from the data host and put it in place (small: no resume worth keeping).
pub async fn download(client: &reqwest::Client, app_data: &Path) -> Result<(), String> {
    let pack = wanted().ok_or("This build names no levels pack.")?;
    let part = app_data
        .join("packs")
        .join(format!("{NAME}-{}.tar.gz.part", pack.version));
    std::fs::create_dir_all(part.parent().ok_or("No folder for the levels.")?)
        .map_err(|e| e.to_string())?;
    let source = Source {
        url: pack.url(),
        token: None,
        name: "release",
    };
    let received = AtomicU64::new(0);
    let res = match fetch_into(client, &source, &part, pack.size, &received).await {
        Ok(()) => std::fs::read(&part)
            .map_err(|e| e.to_string())
            .and_then(|bytes| install(&pack, &bytes, &path_in(app_data))),
        Err(e) => Err(e),
    };
    let _ = std::fs::remove_file(&part);
    res
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;

    fn gz(text: &str) -> Vec<u8> {
        let mut e = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        e.write_all(text.as_bytes()).unwrap();
        e.finish().unwrap()
    }

    #[test]
    fn a_word_gets_the_level_of_its_kind_else_its_lowest() {
        let t = parse(&gz(
            "# NT2Lex\nhuis\tnoun\tA1\nlopen\tverb\tA1\nlopen\tnoun\tB2\nbank\tnoun\tA2\n",
        ))
        .unwrap();
        assert_eq!(level_in(&t, "Huis", Some("noun")).as_deref(), Some("A1"));
        assert_eq!(level_in(&t, "lopen", Some("noun")).as_deref(), Some("B2"));
        assert_eq!(level_in(&t, "lopen", Some("adj")).as_deref(), Some("A1"));
        assert_eq!(level_in(&t, "fiets", None), None);
    }

    #[test]
    fn the_real_file_reads() {
        let bytes =
            std::fs::read("../../../server/nlp/src/vuurtoren_nlp/levels-nl.tsv.gz").unwrap();
        let t = parse(&bytes).unwrap();
        assert!(t.len() > 10_000);
        assert_eq!(level_in(&t, "huis", Some("noun")).as_deref(), Some("A1"));
    }

    #[test]
    fn a_damaged_archive_is_refused() {
        let pack = Pack {
            name: NAME,
            version: "x".into(),
            sha256: "00".into(),
            size: 3,
        };
        assert!(install(&pack, b"abc", Path::new("/tmp/levels-test")).is_err());
    }
}
