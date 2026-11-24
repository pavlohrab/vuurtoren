//! The recordings pack on a phone (`audio-nl`): the recorded words, example sentences and story
//! paragraphs in a female and a male voice, about 230 MB. Without it a phone without a server
//! speaks with the system's own Dutch voice.
//!
//! The clips live at `<app data>/packs/audio-nl/<voice>/<clip>.mp3`. `download` fetches the
//! archive of the version in `packs.json` the same way as the dictionary (the connected
//! Vuurtoren server first, else the data host; resumed; size and SHA-256 checked), but checks and
//! unpacks it from the file instead of memory, since it is large for a phone. The new folder
//! replaces the old one only once it is complete.

use std::io::Read as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicU64;

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::dictionary::{fetch_into, Source};

/// The language server's pack manifest (the same file the dictionary reads).
const MANIFEST: &str = include_str!("../../../../server/nlp/src/vuurtoren_nlp/packs.json");
/// The data host, or another address given when the app is built (`VUURTOREN_DATA_URL`).
const DATA_HOST: &str = match option_env!("VUURTOREN_DATA_URL") {
    Some(url) => url,
    None => "https://data.vuurtoren.app",
};
const NAME: &str = "audio-nl";

/// The recordings pack this build wants.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Pack {
    pub version: String,
    pub sha256: String,
    pub size: u64,
}

impl Pack {
    pub fn wanted() -> Option<Pack> {
        let manifest: serde_json::Value = serde_json::from_str(MANIFEST).ok()?;
        let pack = manifest.pointer(&format!("/packs/{NAME}"))?;
        Some(Pack {
            version: pack.get("version")?.as_str()?.into(),
            sha256: pack.get("sha256")?.as_str()?.into(),
            size: pack.get("size")?.as_u64()?,
        })
    }

    pub fn file_name(&self) -> String {
        format!("{NAME}-{}.tar.gz", self.version)
    }

    pub fn url(&self) -> String {
        format!("{DATA_HOST}/packs-{}/{}", self.version, self.file_name())
    }

    pub fn server_url(&self, nlp: &str) -> String {
        format!("{}/packs/{}", nlp.trim_end_matches('/'), self.file_name())
    }
}

/// The folder of clips on this device.
pub fn dir_in(app_data: &Path) -> PathBuf {
    app_data.join("packs").join(NAME)
}

/// Where an unfinished download waits.
pub fn part_in(app_data: &Path, pack: &Pack) -> PathBuf {
    app_data
        .join("packs")
        .join(format!("{NAME}-{}.tar.gz.part", pack.version))
}

/// The version installed, written last, once the folder is complete.
fn marker_in(app_data: &Path) -> PathBuf {
    app_data.join("packs").join(format!("{NAME}.version"))
}

/// The installed version, or `None` without a complete pack.
pub fn installed(app_data: &Path) -> Option<String> {
    if !dir_in(app_data).is_dir() {
        return None;
    }
    std::fs::read_to_string(marker_in(app_data))
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// Bytes the clips take on disk.
pub fn bytes(app_data: &Path) -> u64 {
    fn walk(dir: &Path) -> u64 {
        std::fs::read_dir(dir).map_or(0, |entries| {
            entries
                .flatten()
                .map(|e| match e.metadata() {
                    Ok(m) if m.is_dir() => walk(&e.path()),
                    Ok(m) => m.len(),
                    Err(_) => 0,
                })
                .sum()
        })
    }
    walk(&dir_in(app_data))
}

/// A voice or clip id is a plain name (`female`, `word-1a2b3c`): never a path.
fn plain(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 80
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// The clip's bytes, or `None` when the pack is not here or has no such clip.
pub fn clip(app_data: &Path, voice: &str, id: &str) -> Option<Vec<u8>> {
    if !plain(voice) || !plain(id) {
        return None;
    }
    std::fs::read(dir_in(app_data).join(voice).join(format!("{id}.mp3"))).ok()
}

/// Check the archive on disk (size, SHA-256) by reading it once.
fn check(archive: &Path, pack: &Pack) -> Result<(), String> {
    let size = std::fs::metadata(archive).map_err(|e| e.to_string())?.len();
    if size != pack.size {
        return Err(format!("The download has {size} bytes, not {}.", pack.size));
    }
    let mut file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut buf = vec![0u8; 1 << 16];
    loop {
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hash.update(&buf[..n]);
    }
    let sum: String = hash.finalize().iter().map(|b| format!("{b:02x}")).collect();
    if sum != pack.sha256 {
        return Err("The download is damaged (its checksum does not match).".into());
    }
    Ok(())
}

/// Unpack the archive's `audio-nl/<voice>/<clip>.mp3` files into a new folder, then put it in
/// place of the old one and write the version. Nothing outside the pack's folder is written.
pub fn install(archive: &Path, pack: &Pack, app_data: &Path) -> Result<(), String> {
    check(archive, pack)?;
    let packs = app_data.join("packs");
    let fresh = packs.join(format!("{NAME}.new"));
    let _ = std::fs::remove_dir_all(&fresh);
    std::fs::create_dir_all(&fresh).map_err(|e| e.to_string())?;
    let file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
    let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(file));
    let mut clips = 0usize;
    for entry in tar.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        if !entry.header().entry_type().is_file() {
            continue;
        }
        let path = entry.path().map_err(|e| e.to_string())?.into_owned();
        let parts: Vec<String> = path
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect();
        // audio-nl/<voice>/<clip>.mp3 only; anything else (stories.json) is not needed here.
        let [_, voice, name] = parts.as_slice() else {
            continue;
        };
        let Some(id) = name.strip_suffix(".mp3") else {
            continue;
        };
        if !plain(voice) || !plain(id) {
            continue;
        }
        let dir = fresh.join(voice);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let mut out = std::fs::File::create(dir.join(name)).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
        clips += 1;
    }
    if clips == 0 {
        let _ = std::fs::remove_dir_all(&fresh);
        return Err("The download holds no recordings.".into());
    }
    let dest = dir_in(app_data);
    let _ = std::fs::remove_file(marker_in(app_data));
    let _ = std::fs::remove_dir_all(&dest);
    std::fs::rename(&fresh, &dest).map_err(|e| e.to_string())?;
    std::fs::write(marker_in(app_data), &pack.version).map_err(|e| e.to_string())
}

/// Fetch the archive from the first source that has it (resuming), check it and unpack it.
/// Says which source it came from; a damaged download is removed so the next try starts clean.
pub async fn download(
    client: &reqwest::Client,
    sources: &[Source],
    pack: &Pack,
    app_data: &Path,
    received: &AtomicU64,
) -> Result<&'static str, String> {
    let part = part_in(app_data, pack);
    std::fs::create_dir_all(part.parent().ok_or("No folder for the recordings.")?)
        .map_err(|e| e.to_string())?;
    let mut last = String::from("No place to download the recordings from.");
    for source in sources {
        if let Err(e) = fetch_into(client, source, &part, pack.size, received).await {
            last = e;
            continue;
        }
        let res = {
            let (part, pack, app_data) = (part.clone(), pack.clone(), app_data.to_path_buf());
            tauri::async_runtime::spawn_blocking(move || install(&part, &pack, &app_data))
                .await
                .map_err(|e| e.to_string())?
        };
        let _ = std::fs::remove_file(&part);
        return res.map(|()| source.name);
    }
    Err(last)
}

/// Remove the recordings (and an unfinished download) from this device.
pub fn remove(app_data: &Path) {
    let _ = std::fs::remove_file(marker_in(app_data));
    let _ = std::fs::remove_dir_all(dir_in(app_data));
    if let Some(pack) = Pack::wanted() {
        let _ = std::fs::remove_file(part_in(app_data, &pack));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn archive(dir: &Path) -> (PathBuf, Pack) {
        let path = dir.join("audio.tar.gz");
        let file = std::fs::File::create(&path).unwrap();
        let mut tar = tar::Builder::new(flate2::write::GzEncoder::new(
            file,
            flate2::Compression::fast(),
        ));
        for (name, body) in [
            ("audio-nl/female/word-abc.mp3", &b"ID3female"[..]),
            ("audio-nl/male/word-abc.mp3", &b"ID3male"[..]),
            ("audio-nl/stories.json", &b"{}"[..]),
            ("audio-nl/../../evil.mp3", &b"no"[..]),
        ] {
            let mut h = tar::Header::new_gnu();
            h.set_size(body.len() as u64);
            h.set_mode(0o644);
            h.set_cksum();
            // `append_data` refuses "..": write the raw name as an attacker's archive would.
            let _ = tar.append_data(&mut h, name, body);
        }
        tar.into_inner().unwrap().finish().unwrap();
        let bytes = std::fs::read(&path).unwrap();
        let sha256 = Sha256::digest(&bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        (
            path,
            Pack {
                version: "9.9.9".into(),
                sha256,
                size: bytes.len() as u64,
            },
        )
    }

    #[test]
    fn installs_a_checked_archive_and_serves_its_clips() {
        let tmp = tempfile::tempdir().unwrap();
        let (path, pack) = archive(tmp.path());
        let data = tmp.path().join("app");
        install(&path, &pack, &data).unwrap();
        assert_eq!(installed(&data).as_deref(), Some("9.9.9"));
        assert_eq!(clip(&data, "female", "word-abc").unwrap(), b"ID3female");
        assert_eq!(clip(&data, "male", "word-abc").unwrap(), b"ID3male");
        assert!(clip(&data, "female", "word-none").is_none());
        assert!(clip(&data, "..", "evil").is_none());
        assert!(clip(&data, "female", "../male/word-abc").is_none());
        assert!(!tmp.path().join("evil.mp3").exists());
        assert!(bytes(&data) > 0);
        remove(&data);
        assert!(installed(&data).is_none());
    }

    #[test]
    fn refuses_a_damaged_archive_and_keeps_what_was_there() {
        let tmp = tempfile::tempdir().unwrap();
        let (path, pack) = archive(tmp.path());
        let data = tmp.path().join("app");
        install(&path, &pack, &data).unwrap();
        let bad = Pack {
            sha256: "0".repeat(64),
            ..pack
        };
        assert!(install(&path, &bad, &data).is_err());
        assert_eq!(installed(&data).as_deref(), Some("9.9.9"));
    }

    #[test]
    fn the_wanted_pack_comes_from_the_manifest() {
        let pack = Pack::wanted().expect("audio-nl in packs.json");
        assert!(pack.size > 100_000_000);
        assert!(pack
            .url()
            .ends_with(&format!("/packs-{v}/audio-nl-{v}.tar.gz", v = pack.version)));
    }
}
