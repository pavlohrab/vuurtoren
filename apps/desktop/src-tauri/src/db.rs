//! The local database of the offline app: one SQLite file in a folder the user can see
//! (`~/Documents/Kenning/kenning.sqlite` by default), opened natively with rusqlite.
//!
//! The web app's `SqlDriver` (packages/db/src/native.ts) sends every statement here; schema,
//! migrations and projections are the same TypeScript code as in the browser. Values cross the
//! IPC boundary as JSON: blobs as `{"$b": base64}`, integers beyond 2^53 as `{"$i": "123"}`.
//!
//! Next to the file sits `kenning.sqlite.lock` (single-writer guard): it names the computer and
//! process that has the file open. A lock from another computer (the folder is synced by
//! Dropbox, OneDrive, Syncthing, …) is reported instead of silently opening the file twice, and
//! conflict copies made by sync tools are listed so the app can warn about them.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use rusqlite::types::{Value, ValueRef};
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value as Json};

pub const DB_FILE: &str = "kenning.sqlite";
/// Largest integer a JS number holds exactly.
const MAX_SAFE: i64 = (1 << 53) - 1;
const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

/// The default database file: `<Documents>/Kenning/kenning.sqlite`.
pub fn default_path(documents: &Path) -> PathBuf {
    documents.join("Kenning").join(DB_FILE)
}

/// JSON parameter -> SQLite value (see the module docs for the encoding).
pub fn to_value(v: &Json) -> Result<Value, String> {
    Ok(match v {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Integer(i64::from(*b)),
        Json::Number(n) => match n.as_i64() {
            Some(i) => Value::Integer(i),
            None => Value::Real(n.as_f64().ok_or("bad number")?),
        },
        Json::String(s) => Value::Text(s.clone()),
        Json::Object(o) => {
            if let Some(Json::String(b)) = o.get("$b") {
                Value::Blob(B64.decode(b).map_err(|e| e.to_string())?)
            } else if let Some(Json::String(i)) = o.get("$i") {
                Value::Integer(i.parse().map_err(|_| format!("bad integer {i}"))?)
            } else {
                return Err("unsupported parameter object".into());
            }
        }
        Json::Array(_) => return Err("unsupported parameter array".into()),
    })
}

/// SQLite value -> JSON (see the module docs for the encoding).
pub fn to_json(v: ValueRef<'_>) -> Json {
    match v {
        ValueRef::Null => Json::Null,
        ValueRef::Integer(i) if (-MAX_SAFE..=MAX_SAFE).contains(&i) => json!(i),
        ValueRef::Integer(i) => json!({ "$i": i.to_string() }),
        ValueRef::Real(f) => json!(f),
        ValueRef::Text(t) => Json::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => json!({ "$b": B64.encode(b) }),
    }
}

/// Run one statement (or, without parameters, a script of several); rows as JSON objects.
pub fn exec(conn: &Connection, sql: &str, params: &[Json]) -> Result<Vec<Json>, String> {
    let values = params.iter().map(to_value).collect::<Result<Vec<_>, _>>()?;
    // Without parameters a statement may be a script of several (migrations): run it as a
    // batch unless it returns rows (same rule as the node:sqlite driver).
    let mut stmt = match conn.prepare(sql) {
        Ok(stmt) if values.is_empty() && stmt.column_count() == 0 => {
            drop(stmt);
            conn.execute_batch(sql).map_err(|e| e.to_string())?;
            return Ok(vec![]);
        }
        Ok(stmt) => stmt,
        Err(_) if values.is_empty() => {
            conn.execute_batch(sql).map_err(|e| e.to_string())?;
            return Ok(vec![]);
        }
        Err(e) => return Err(e.to_string()),
    };
    let bind = rusqlite::params_from_iter(values.iter());
    if stmt.column_count() == 0 {
        stmt.execute(bind).map_err(|e| e.to_string())?;
        return Ok(vec![]);
    }
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let mut rows = stmt.query(bind).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let mut obj = Map::with_capacity(names.len());
        for (i, name) in names.iter().enumerate() {
            obj.insert(
                name.clone(),
                to_json(row.get_ref(i).map_err(|e| e.to_string())?),
            );
        }
        out.push(Json::Object(obj));
    }
    Ok(out)
}

pub fn open_conn(path: &Path) -> Result<Connection, String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)
            .map_err(|e| format!("Could not create the folder {}: {e}", dir.display()))?;
    }
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
    )
    .map_err(|e| format!("Could not open {}: {e}", path.display()))?;
    // A rollback journal, not WAL: one file (plus a short-lived journal) is what sync tools and
    // "copy the folder" backups handle well.
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "journal_mode", "DELETE")
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| e.to_string())?;
    Ok(conn)
}

/// A consistent copy of the whole database (no transaction may be open).
pub fn export(conn: &Connection, scratch: &Path) -> Result<Vec<u8>, String> {
    let _ = fs::remove_file(scratch);
    conn.execute("VACUUM INTO ?1", [scratch.to_string_lossy()])
        .map_err(|e| e.to_string())?;
    let bytes = fs::read(scratch).map_err(|e| e.to_string());
    let _ = fs::remove_file(scratch);
    bytes
}

/// Check a candidate backup file (same rules as `inspectBackup` in packages/db/src/backup.ts)
/// and prepare it for use: a new device id, and no projection version so every projection is
/// rebuilt from the event log.
pub fn prepare_import(path: &Path, max_schema: i64, device_id: &str) -> Result<(), String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|_| "This file is not a SQLite database.".to_string())?;
    if version > max_schema {
        return Err(format!(
            "This backup is from a newer Kenning (schema v{version}; this app supports v{max_schema})."
        ));
    }
    for table in ["meta", "events"] {
        let found: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                [table],
                |r| r.get(0),
            )
            .map_err(|_| "This file is not a SQLite database.".to_string())?;
        if found == 0 {
            return Err(format!(
                "This SQLite file is not a Kenning backup (no {table})."
            ));
        }
    }
    conn.execute(
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('device_id', ?1)",
        [serde_json::to_string(device_id).unwrap_or_default()],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM meta WHERE key = 'projection_version'", [])
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "journal_mode", "DELETE")
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ------------------------------------------------------------------------------- the lock

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LockInfo {
    pub app: String,
    pub host: String,
    pub pid: u32,
    /// Unix seconds: when the file was opened, and the last sign of life (every minute).
    pub since: u64,
    pub seen: u64,
}

pub fn lock_path(db: &Path) -> PathBuf {
    let mut name = db.file_name().unwrap_or_default().to_os_string();
    name.push(".lock");
    db.with_file_name(name)
}

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub fn hostname() -> String {
    gethostname::gethostname().to_string_lossy().into_owned()
}

pub fn read_lock(db: &Path) -> Option<LockInfo> {
    serde_json::from_slice(&fs::read(lock_path(db)).ok()?).ok()
}

/// Take the lock for `me`. Fails with the current holder when another computer holds it, unless
/// `force`. A lock from this computer is stale: the app runs once per user (single-instance
/// plugin), so it was left by a crash.
pub fn acquire_lock(db: &Path, me: &LockInfo, force: bool) -> Result<(), LockInfo> {
    if let Some(other) = read_lock(db) {
        if other.host != me.host && !force {
            return Err(other);
        }
    }
    write_lock(db, me);
    Ok(())
}

pub fn write_lock(db: &Path, me: &LockInfo) {
    if let Some(dir) = db.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let _ = fs::write(
        lock_path(db),
        serde_json::to_vec_pretty(me).unwrap_or_default(),
    );
}

/// Remove the lock if it is still ours (another computer may have taken it over by force).
pub fn release_lock(db: &Path, me: &LockInfo) {
    if read_lock(db).is_some_and(|l| l.host == me.host && l.pid == me.pid) {
        let _ = fs::remove_file(lock_path(db));
    }
}

/// Copies of the database that sync tools leave next to it when two computers changed it:
/// Dropbox `kenning (Anna's conflicted copy 2026-11-18).sqlite`, Syncthing
/// `kenning.sync-conflict-20261118-101010-ABCDEF.sqlite`, OneDrive `kenning-LAPTOP.sqlite`,
/// Google Drive / Nextcloud `kenning (1).sqlite`, `kenning (conflicted copy ...).sqlite`.
pub fn conflict_copies(db: &Path) -> Vec<String> {
    let Some(dir) = db.parent() else {
        return vec![];
    };
    let main = db
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let stem = main.trim_end_matches(".sqlite").to_lowercase();
    let mut found: Vec<String> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|name| name != &main && is_conflict_name(&name.to_lowercase(), &stem))
        .collect();
    found.sort();
    found
}

fn is_conflict_name(name: &str, stem: &str) -> bool {
    let Some(rest) = name.strip_prefix(stem) else {
        return false;
    };
    if !(name.ends_with(".sqlite") || name.contains(".sqlite.") || name.contains("conflict")) {
        return false;
    }
    if name.ends_with(".lock") || name.ends_with("-journal") || name.ends_with(".before-restore") {
        return false;
    }
    rest.contains("conflict")
        || (rest.starts_with(" (") && rest[2..].starts_with(|c: char| c.is_ascii_digit()))
        || (rest.starts_with('-') && rest.ends_with(".sqlite") && rest.len() > "-.sqlite".len())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Connection {
        Connection::open_in_memory().unwrap()
    }

    #[test]
    fn values_round_trip_through_json() {
        let c = mem();
        exec(&c, "CREATE TABLE t (a, b, c, d, e)", &[]).unwrap();
        let big = json!({ "$i": "9007199254740993" });
        let blob = json!({ "$b": B64.encode([0u8, 1, 255]) });
        exec(
            &c,
            "INSERT INTO t VALUES (?, ?, ?, ?, ?)",
            &[
                json!(42),
                json!(1.5),
                json!("hé"),
                blob.clone(),
                big.clone(),
            ],
        )
        .unwrap();
        let rows = exec(&c, "SELECT * FROM t", &[]).unwrap();
        assert_eq!(
            rows[0],
            json!({ "a": 42, "b": 1.5, "c": "hé", "d": blob, "e": big })
        );
        let nulls = exec(&c, "SELECT NULL AS n, ? AS t", &[json!(true)]).unwrap();
        assert_eq!(nulls[0], json!({ "n": null, "t": 1 }));
    }

    #[test]
    fn scripts_and_statements_without_rows() {
        let c = mem();
        let rows = exec(
            &c,
            "CREATE TABLE a (x); CREATE TABLE b (y); INSERT INTO a VALUES (1);",
            &[],
        )
        .unwrap();
        assert!(rows.is_empty());
        assert!(exec(&c, "INSERT INTO b VALUES (?)", &[json!(2)])
            .unwrap()
            .is_empty());
        let back = exec(&c, "INSERT INTO b VALUES (3) RETURNING y", &[]).unwrap();
        assert_eq!(back, vec![json!({ "y": 3 })]);
        assert_eq!(
            exec(&c, "PRAGMA user_version", &[]).unwrap(),
            vec![json!({ "user_version": 0 })]
        );
        assert!(exec(&c, "SELEC nonsense", &[]).is_err());
        assert!(to_value(&json!([1])).is_err());
    }

    #[test]
    fn transactions_are_plain_statements() {
        let c = mem();
        exec(&c, "CREATE TABLE t (x)", &[]).unwrap();
        exec(&c, "BEGIN IMMEDIATE", &[]).unwrap();
        exec(&c, "INSERT INTO t VALUES (1)", &[]).unwrap();
        exec(&c, "ROLLBACK", &[]).unwrap();
        assert_eq!(
            exec(&c, "SELECT count(*) AS n FROM t", &[]).unwrap(),
            vec![json!({ "n": 0 })]
        );
    }

    fn kenning_db(path: &Path, version: i64) {
        let c = Connection::open(path).unwrap();
        c.execute_batch(
            "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
             CREATE TABLE events (id INTEGER PRIMARY KEY);
             INSERT INTO meta VALUES ('device_id', '\"old\"'), ('projection_version', '3');",
        )
        .unwrap();
        c.pragma_update(None, "user_version", version).unwrap();
    }

    #[test]
    fn export_and_import_checks() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("k.sqlite");
        kenning_db(&file, 2);
        let conn = open_conn(&file).unwrap();
        let bytes = export(&conn, &dir.path().join("scratch")).unwrap();
        assert!(bytes.starts_with(b"SQLite format 3\0"));

        let candidate = dir.path().join("restore.sqlite");
        fs::write(&candidate, &bytes).unwrap();
        prepare_import(&candidate, 5, "new-device").unwrap();
        let c = Connection::open(&candidate).unwrap();
        let id: String = c
            .query_row("SELECT value FROM meta WHERE key = 'device_id'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(id, "\"new-device\"");
        let pv: i64 = c
            .query_row(
                "SELECT count(*) FROM meta WHERE key = 'projection_version'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(pv, 0);

        let newer = dir.path().join("newer.sqlite");
        kenning_db(&newer, 9);
        assert!(prepare_import(&newer, 5, "x")
            .unwrap_err()
            .contains("newer Kenning"));
        let other = dir.path().join("other.sqlite");
        Connection::open(&other)
            .unwrap()
            .execute_batch("CREATE TABLE meta (key, value)")
            .unwrap();
        assert!(prepare_import(&other, 5, "x")
            .unwrap_err()
            .contains("no events"));
        let junk = dir.path().join("junk.sqlite");
        fs::write(&junk, b"not a database at all, really not").unwrap();
        assert!(prepare_import(&junk, 5, "x").is_err());
    }

    fn me(host: &str, pid: u32) -> LockInfo {
        LockInfo {
            app: "kenning".into(),
            host: host.into(),
            pid,
            since: 1,
            seen: 1,
        }
    }

    #[test]
    fn lock_file_guards_against_a_second_computer() {
        let dir = tempfile::tempdir().unwrap();
        // First start: the folder does not exist yet.
        let db = dir.path().join("Kenning").join(DB_FILE);
        assert_eq!(
            lock_path(&db),
            dir.path().join("Kenning").join("kenning.sqlite.lock")
        );

        acquire_lock(&db, &me("laptop", 10), false).unwrap();
        assert_eq!(read_lock(&db).unwrap().host, "laptop");
        // Same computer: a leftover from a crash, taken over.
        acquire_lock(&db, &me("laptop", 11), false).unwrap();
        assert_eq!(read_lock(&db).unwrap().pid, 11);
        // Another computer (synced folder): refused unless forced.
        let held = acquire_lock(&db, &me("desktop", 5), false).unwrap_err();
        assert_eq!(held.host, "laptop");
        acquire_lock(&db, &me("desktop", 5), true).unwrap();
        // The laptop no longer owns it, so its release leaves the lock alone.
        release_lock(&db, &me("laptop", 11));
        assert!(lock_path(&db).exists());
        release_lock(&db, &me("desktop", 5));
        assert!(!lock_path(&db).exists());
    }

    #[test]
    fn sync_conflict_copies_are_found() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join(DB_FILE);
        for name in [
            "kenning.sqlite",
            "kenning.sqlite.lock",
            "kenning.sqlite-journal",
            "kenning.sqlite.before-restore",
            "kenning (Anna's conflicted copy 2026-11-18).sqlite",
            "kenning.sync-conflict-20261118-101010-ABCDEF.sqlite",
            "kenning-LAPTOP.sqlite",
            "kenning (1).sqlite",
            "kenning-2026-11-18.sqlite.txt",
            "notes.txt",
            "other.sqlite",
        ] {
            fs::write(dir.path().join(name), b"x").unwrap();
        }
        assert_eq!(
            conflict_copies(&db),
            vec![
                "kenning (1).sqlite",
                "kenning (Anna's conflicted copy 2026-11-18).sqlite",
                "kenning-LAPTOP.sqlite",
                "kenning.sync-conflict-20261118-101010-ABCDEF.sqlite",
            ]
        );
    }

    #[test]
    fn default_location_is_documents_kenning() {
        assert_eq!(
            default_path(Path::new("/home/a/Documents")),
            PathBuf::from("/home/a/Documents/Kenning/kenning.sqlite")
        );
    }
}
