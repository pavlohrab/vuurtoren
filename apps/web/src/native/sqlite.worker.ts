/**
 * A worker that opens SQLite databases from bytes (the collection inside an Anki package) and
 * answers read queries, or creates an empty one to write (a package for export) and hands back
 * its file. Each database lives in memory until closed.
 */
import sqlite3InitModule, { type Database } from "@sqlite.org/sqlite-wasm";

type Request =
  | { id: number; op: "open"; bytes: Uint8Array }
  | { id: number; op: "create" }
  | { id: number; op: "run"; db: number; sql: string; params: (string | number | null)[] }
  | { id: number; op: "export"; db: number }
  | { id: number; op: "all"; db: number; sql: string }
  | { id: number; op: "close"; db: number };

const ready = sqlite3InitModule();
const open = new Map<number, Database>();
let next = 1;

self.onmessage = async (ev: MessageEvent<Request>) => {
  const req = ev.data;
  try {
    const sqlite3 = await ready;
    if (req.op === "open") {
      const db = new sqlite3.oo1.DB(":memory:", "c");
      const p = sqlite3.wasm.allocFromTypedArray(req.bytes);
      const flags =
        sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE;
      const rc = sqlite3.capi.sqlite3_deserialize(
        db.pointer as number,
        "main",
        p,
        req.bytes.length,
        req.bytes.length,
        flags,
      );
      if (rc !== 0) throw new Error(`The collection could not be opened (SQLite error ${rc}).`);
      const handle = next++;
      open.set(handle, db);
      self.postMessage({ id: req.id, result: handle });
    } else if (req.op === "create") {
      const handle = next++;
      open.set(handle, new sqlite3.oo1.DB(":memory:", "c"));
      self.postMessage({ id: req.id, result: handle });
    } else if (req.op === "run") {
      const db = open.get(req.db);
      if (!db) throw new Error("The database is closed.");
      if (req.params.length) db.exec({ sql: req.sql, bind: req.params });
      else db.exec(req.sql);
      self.postMessage({ id: req.id, result: null });
    } else if (req.op === "export") {
      const db = open.get(req.db);
      if (!db) throw new Error("The database is closed.");
      self.postMessage({ id: req.id, result: sqlite3.capi.sqlite3_js_db_export(db) });
    } else if (req.op === "all") {
      const db = open.get(req.db);
      if (!db) throw new Error("The collection is closed.");
      const rows = db.exec({ sql: req.sql, rowMode: "object", returnValue: "resultRows" });
      self.postMessage({ id: req.id, result: rows });
    } else {
      open.get(req.db)?.close();
      open.delete(req.db);
      self.postMessage({ id: req.id, result: null });
    }
  } catch (e) {
    self.postMessage({ id: req.id, error: e instanceof Error ? e.message : String(e) });
  }
};
