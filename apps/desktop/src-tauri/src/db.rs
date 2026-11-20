//! The local database of the offline app: one SQLite file in a folder the user can see
//! (`~/Documents/Vuurtoren/vuurtoren.sqlite` by default), opened natively with rusqlite.
//!
//! The web app's `SqlDriver` (packages/db/src/native.ts) sends every statement here; schema,
//! migrations and projections are the same TypeScript code as in the browser. Values cross the
//! IPC boundary as JSON: blobs as `{"$b": base64}`, integers beyond 2^53 as `{"$i": "123"}`.
//!
//! Next to the file sits `vuurtoren.sqlite.lock` (single-writer guard): it names the computer and
//! process that has the file open. A lock from another computer (the folder is synced by
//! Dropbox, OneDrive, Syncthing, …) is reported instead of silently opening the file twice, and
//! conflict copies made by sync tools are listed so the app can warn about them.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
use rusqlite::types::{Value, ValueRef};
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value as Json};

pub const DB_FILE: &str = "vuurtoren.sqlite";
/// Largest integer a JS number holds exactly.
const MAX_SAFE: i64 = (1 << 53) - 1;
const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

/// The default database file: `<Documents>/Vuurtoren/vuurtoren.sqlite`.
pub fn default_path(documents: &Path) -> PathBuf {
    documents.join("Vuurtoren").join(DB_FILE)
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

// ------------------------------------------------------------------- the page's statements

/// The table the app's history lives in: append-only, the one thing sync and every projection
/// are rebuilt from.
const EVENTS: &str = "EVENTS";

/// Words of a statement outside string literals and comments, upper-cased, plus `.` and `;`.
/// Quoted names (`"events"`, `[events]`, `` `events` ``) count as plain words. Only the guard's
/// rough view of the SQL: SQLite parses it for real.
fn words(sql: &str) -> Vec<String> {
    let b = sql.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        let c = b[i];
        if c == b'\'' {
            // A string literal; '' inside it reads as two literals, which is fine here.
            i += 1;
            while i < b.len() && b[i] != b'\'' {
                i += 1;
            }
            i += 1;
        } else if c == b'-' && b.get(i + 1) == Some(&b'-') {
            while i < b.len() && b[i] != b'\n' {
                i += 1;
            }
        } else if c == b'/' && b.get(i + 1) == Some(&b'*') {
            i += 2;
            while i < b.len() && !(b[i] == b'*' && b.get(i + 1) == Some(&b'/')) {
                i += 1;
            }
            i += 2;
        } else if matches!(c, b'"' | b'`' | b'[') {
            let close = if c == b'[' { b']' } else { c };
            let start = i + 1;
            i = start;
            while i < b.len() && b[i] != close {
                i += 1;
            }
            out.push(sql[start..i.min(b.len())].to_ascii_uppercase());
            i += 1;
        } else if c.is_ascii_alphanumeric() || c == b'_' || c >= 0x80 {
            let start = i;
            while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'_' || b[i] >= 0x80) {
                i += 1;
            }
            out.push(sql[start..i].to_ascii_uppercase());
        } else {
            if c == b'.' || c == b';' {
                out.push((c as char).to_string());
            }
            i += 1;
        }
    }
    out
}

/// Why a statement from the page is refused, if it is. The page runs the app's own SQL; these
/// are things that SQL never does and that would reach past the database or reshape the
/// history: other files (`ATTACH`, `VACUUM INTO`), and renaming the events table or dropping
/// its columns (its migrations only ever add one).
fn refused(sql: &str) -> Option<&'static str> {
    let w = words(sql);
    let at = |i: usize| w.get(i).map(String::as_str);
    for (i, word) in w.iter().enumerate() {
        match word.as_str() {
            "ATTACH" | "DETACH" => return Some("Other database files cannot be opened here."),
            "VACUUM" => return Some("The database file is copied and compacted by the app."),
            "ALTER" if at(i + 1) == Some("TABLE") => {
                // ALTER TABLE [schema .] name ADD ...
                let name = if at(i + 3) == Some(".") { i + 4 } else { i + 2 };
                if at(name) == Some(EVENTS) && at(name + 1) != Some("ADD") {
                    return Some("The history table can only gain columns.");
                }
            }
            _ => {}
        }
    }
    None
}

/// What SQLite may do while it runs a statement from the page: no other database files, no
/// dropping the events table or its append-only trigger, no editing the schema by hand.
fn page_authorizer(ctx: AuthContext<'_>) -> Authorization {
    let events = |t: &str| t.eq_ignore_ascii_case(EVENTS);
    match ctx.action {
        AuthAction::Attach { .. } | AuthAction::Detach { .. } => Authorization::Deny,
        AuthAction::DropTable { table_name } | AuthAction::DropTempTable { table_name }
            if events(table_name) =>
        {
            Authorization::Deny
        }
        AuthAction::DropTrigger { table_name, .. }
        | AuthAction::DropTempTrigger { table_name, .. }
            if events(table_name) =>
        {
            Authorization::Deny
        }
        AuthAction::Pragma {
            pragma_name,
            pragma_value: Some(_),
        } if pragma_name.eq_ignore_ascii_case("writable_schema") => Authorization::Deny,
        AuthAction::Function { function_name }
            if function_name.eq_ignore_ascii_case("load_extension") =>
        {
            Authorization::Deny
        }
        _ => Authorization::Allow,
    }
}

/// A statement (or script) from the web app: `exec` behind the guards above. The app's own
/// operations in Rust (backup copies, moving the file) do not go through here.
pub fn page_exec(conn: &Connection, sql: &str, params: &[Json]) -> Result<Vec<Json>, String> {
    if let Some(why) = refused(sql) {
        return Err(why.into());
    }
    conn.authorizer(Some(page_authorizer));
    let result = exec(conn, sql, params);
    conn.authorizer(None::<fn(AuthContext<'_>) -> Authorization>);
    result
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
            "This backup is from a newer Vuurtoren (schema v{version}; this app supports v{max_schema})."
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
                "This SQLite file is not a Vuurtoren backup (no {table})."
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
/// Dropbox `vuurtoren (Anna's conflicted copy 2026-11-18).sqlite`, Syncthing
/// `vuurtoren.sync-conflict-20261118-101010-ABCDEF.sqlite`, OneDrive `vuurtoren-LAPTOP.sqlite`,
/// Google Drive / Nextcloud `vuurtoren (1).sqlite`, `vuurtoren (conflicted copy ...).sqlite`.
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

    fn vuurtoren_db(path: &Path, version: i64) {
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
        vuurtoren_db(&file, 2);
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
        vuurtoren_db(&newer, 9);
        assert!(prepare_import(&newer, 5, "x")
            .unwrap_err()
            .contains("newer Vuurtoren"));
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
            app: "vuurtoren".into(),
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
        let db = dir.path().join("Vuurtoren").join(DB_FILE);
        assert_eq!(
            lock_path(&db),
            dir.path().join("Vuurtoren").join("vuurtoren.sqlite.lock")
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
            "vuurtoren.sqlite",
            "vuurtoren.sqlite.lock",
            "vuurtoren.sqlite-journal",
            "vuurtoren.sqlite.before-restore",
            "vuurtoren (Anna's conflicted copy 2026-11-18).sqlite",
            "vuurtoren.sync-conflict-20261118-101010-ABCDEF.sqlite",
            "vuurtoren-LAPTOP.sqlite",
            "vuurtoren (1).sqlite",
            "vuurtoren-2026-11-18.sqlite.txt",
            "notes.txt",
            "other.sqlite",
        ] {
            fs::write(dir.path().join(name), b"x").unwrap();
        }
        assert_eq!(
            conflict_copies(&db),
            vec![
                "vuurtoren (1).sqlite",
                "vuurtoren (Anna's conflicted copy 2026-11-18).sqlite",
                "vuurtoren-LAPTOP.sqlite",
                "vuurtoren.sync-conflict-20261118-101010-ABCDEF.sqlite",
            ]
        );
    }

    #[test]
    fn the_page_runs_the_apps_sql_but_cannot_reach_other_files_or_reshape_the_history() {
        let dir = tempfile::tempdir().unwrap();
        let c = open_conn(&dir.path().join(DB_FILE)).unwrap();
        // The app's own kind of statements: schema, migrations, compaction, pragmas.
        for sql in [
            "CREATE TABLE events (id TEXT PRIMARY KEY, payload TEXT NOT NULL)",
            "CREATE TRIGGER events_no_update BEFORE UPDATE ON events
               BEGIN SELECT RAISE(ABORT, 'events is append-only'); END",
            "CREATE TABLE notes (x); ALTER TABLE notes ADD COLUMN y TEXT; DROP TABLE notes;",
            "ALTER TABLE events ADD COLUMN v INTEGER NOT NULL DEFAULT 1",
            "PRAGMA user_version = 3",
            "INSERT INTO events (id, payload) VALUES ('a', 'attach vacuum'), ('b', '{}')",
            "DELETE FROM events WHERE id = 'b'",
        ] {
            page_exec(&c, sql, &[]).unwrap_or_else(|e| panic!("{sql}: {e}"));
        }
        assert_eq!(
            page_exec(&c, "SELECT count(*) AS n FROM events", &[]).unwrap(),
            vec![json!({ "n": 1 })]
        );
        let outside = dir.path().join("outside.sqlite");
        for sql in [
            format!("ATTACH '{}' AS x", outside.display()),
            "ATTACH ? AS x".into(),
            format!("VACUUM INTO '{}'", outside.display()),
            "vacuum".into(),
            "DROP TABLE events".into(),
            "DROP TABLE IF EXISTS main.\"events\"".into(),
            "DROP TRIGGER events_no_update".into(),
            "ALTER TABLE events RENAME TO old".into(),
            "ALTER TABLE main.[events] DROP COLUMN v".into(),
            "ALTER TABLE events RENAME COLUMN payload TO p".into(),
            "PRAGMA writable_schema = ON".into(),
            "SELECT load_extension('x')".into(),
            "SELECT 1; /* a script */ DROP TABLE events;".into(),
        ] {
            let params = if sql.contains('?') {
                vec![json!(outside.to_string_lossy())]
            } else {
                vec![]
            };
            assert!(
                page_exec(&c, &sql, &params).is_err(),
                "{sql} should be refused"
            );
        }
        assert!(!outside.exists());
        assert_eq!(
            page_exec(&c, "SELECT count(*) AS n FROM events", &[]).unwrap(),
            vec![json!({ "n": 1 })]
        );
        // The guard is for the page only: the app's own backup copy still works.
        assert!(!export(&c, &dir.path().join("copy.sqlite"))
            .unwrap()
            .is_empty());
        // Words inside literals and comments do not count.
        assert_eq!(refused("SELECT 'VACUUM' -- ATTACH\n /* DETACH */"), None);
    }

    #[test]
    fn default_location_is_documents_vuurtoren() {
        assert_eq!(
            default_path(Path::new("/home/a/Documents")),
            PathBuf::from("/home/a/Documents/Vuurtoren/vuurtoren.sqlite")
        );
    }
}
