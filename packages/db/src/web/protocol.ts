/**
 * Message protocol between the main thread and the SQLite worker. Every request carries an
 * `id`; the worker answers with a response with the same id. Values are structured-clone
 * safe (string, number, bigint, Uint8Array, null).
 */
import type { SqlRow, SyncDb } from "../driver-core.js";
import type { SqlValue } from "../types.js";

export type WorkerRequest =
  | { id: number; op: "open"; name: string }
  | { id: number; op: "exec"; sql: string; params: readonly SqlValue[] }
  | { id: number; op: "close" };

export type WorkerResult = { persistent: boolean } | SqlRow[] | null;

export type WorkerResponse =
  { id: number; ok: true; result: WorkerResult } | { id: number; ok: false; error: string };

/** Result of opening: the database and whether it is persistent (OPFS) or in-memory. */
export interface OpenedDb {
  db: SyncDb;
  persistent: boolean;
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
      }
    } catch (err) {
      return { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };
}

/** ArrayBuffers inside result rows that can be transferred instead of copied. */
export function collectTransferables(rows: WorkerResult): Transferable[] {
  if (!Array.isArray(rows)) return [];
  const out: Transferable[] = [];
  for (const row of rows) {
    for (const v of Object.values(row)) {
      if (v instanceof Uint8Array && v.buffer instanceof ArrayBuffer) out.push(v.buffer);
    }
  }
  return out;
}
