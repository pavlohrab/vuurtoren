/**
 * Message protocol between the main thread and the SQLite worker. Every request carries an
 * `id`; the worker answers with a response with the same id. Values are structured-clone
 * safe (string, number, bigint, Uint8Array, null).
 */
import { checkBackupHeader, inspectBackup, prepareImported } from "../backup.js";
import type { SqlRow, SyncDb } from "../driver-core.js";
import type { SqlValue } from "../types.js";

export type WorkerRequest =
  | { id: number; op: "open"; name: string }
  | { id: number; op: "exec"; sql: string; params: readonly SqlValue[] }
  | { id: number; op: "close" }
  /** The raw database file (call only while no transaction is open). */
  | { id: number; op: "export" }
  /** Replace the database with a backup file: validated, new device id, reopened. */
  | { id: number; op: "import"; bytes: Uint8Array };

export type WorkerResult = { persistent: boolean } | SqlRow[] | Uint8Array | null;

export type WorkerResponse =
  { id: number; ok: true; result: WorkerResult } | { id: number; ok: false; error: string };

/** Result of opening: the database and whether it is persistent (OPFS) or in-memory. */
export interface OpenedDb {
  db: SyncDb;
  persistent: boolean;
  /** The whole database file as bytes. */
  exportFile(): Uint8Array;
  /** Replace the database file (the current `db` is already closed) and open it again. */
  importFile(bytes: Uint8Array): Promise<SyncDb>;
}

/**
 * Create the worker-side request handler. `open` is injected so the same code runs with
 * sqlite-wasm in the real worker and with node:sqlite in tests.
 */
export function createRequestHandler(
  open: (name: string) => Promise<OpenedDb>,
): (req: WorkerRequest) => Promise<WorkerResponse> {
  let opened: OpenedDb | null = null;
  return async (req) => {
    try {
      switch (req.op) {
        case "open":
          opened ??= await open(req.name);
          return { id: req.id, ok: true, result: { persistent: opened.persistent } };
        case "exec":
          if (!opened) throw new Error("Database is not open");
          return { id: req.id, ok: true, result: opened.db.exec(req.sql, req.params) };
        case "close":
          opened?.db.close();
          opened = null;
          return { id: req.id, ok: true, result: null };
        case "export":
          if (!opened) throw new Error("Database is not open");
          return { id: req.id, ok: true, result: opened.exportFile() };
        case "import": {
          if (!opened) throw new Error("Database is not open");
          checkBackupHeader(req.bytes); // reject obvious non-backups before touching anything
          const previous = opened.exportFile();
          opened.db.close();
          let db = await opened.importFile(req.bytes);
          try {
            inspectBackup(db);
            prepareImported(db);
          } catch (err) {
            // Put the old data back so a bad file never costs the user their database.
            db.close();
            db = await opened.importFile(previous);
            opened = { ...opened, db };
            throw err;
          }
          opened = { ...opened, db };
          return { id: req.id, ok: true, result: null };
        }
      }
    } catch (err) {
      return { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };
}

/** ArrayBuffers inside result rows that can be transferred instead of copied. */
export function collectTransferables(rows: WorkerResult): Transferable[] {
  if (rows instanceof Uint8Array) return rows.buffer instanceof ArrayBuffer ? [rows.buffer] : [];
  if (!Array.isArray(rows)) return [];
  const out: Transferable[] = [];
  for (const row of rows) {
    for (const v of Object.values(row)) {
      if (v instanceof Uint8Array && v.buffer instanceof ArrayBuffer) out.push(v.buffer);
    }
  }
  return out;
}
