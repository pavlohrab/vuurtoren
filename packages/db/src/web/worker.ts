/**
 * Dedicated worker hosting sqlite-wasm. Opens an OPFS database via the opfs-sahpool VFS
 * (needs no COOP/COEP headers); if that fails, uses an in-memory database.
 */
import sqlite3InitModule, {
  type Database,
  type SqlValue as WasmValue,
} from "@sqlite.org/sqlite-wasm";
import type { SqlRow, SyncDb } from "../driver-core.js";
import type { SqlValue } from "../types.js";
import {
  type OpenedDb,
  type WorkerRequest,
  collectTransferables,
  createRequestHandler,
} from "./protocol.js";

/** Adapt an oo1 database to the shared `SyncDb` interface. */
function wrap(db: Database): SyncDb {
  return {
    exec(sql: string, params: readonly SqlValue[] = []): SqlRow[] {
      return db.exec({
        sql,
        ...(params.length > 0 ? { bind: [...params] as WasmValue[] } : {}),
        rowMode: "object",
        returnValue: "resultRows",
      }) as SqlRow[];
    },
    close: () => db.close(),
  };
}

/** Open an in-memory database from serialized bytes (or empty). */
function memoryDb(sqlite3: Sqlite3, bytes?: Uint8Array): Database {
  const db = new sqlite3.oo1.DB(":memory:", "c");
  if (bytes) {
    const p = sqlite3.wasm.allocFromTypedArray(bytes);
    const flags =
      sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE;
    const rc = sqlite3.capi.sqlite3_deserialize(
      db.pointer as number,
      "main",
      p,
      bytes.length,
      bytes.length,
      flags,
    );
    if (rc !== 0) throw new Error(`Could not load the backup (SQLite error ${rc}).`);
  }
  return db;
}

type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModule>>;

async function open(name: string): Promise<OpenedDb> {
  const sqlite3 = await sqlite3InitModule();
  const opfsSupported =
    typeof navigator !== "undefined" && typeof navigator.storage?.getDirectory === "function";
  // On a page reload the previous page's worker may still hold the pool's access handles for a
  // moment; retry before falling back, otherwise every reload would silently lose persistence.
  const attempts = opfsSupported ? 8 : 1;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const pool = await sqlite3.installOpfsSAHPoolVfs({ name: `opfs-sahpool-${name}` });
      const path = `/${name}.sqlite3`;
      const openDb = (): SyncDb => wrap(new pool.OpfsSAHPoolDb(path));
      return {
        db: openDb(),
        persistent: true,
        exportFile: () => pool.exportFile(path),
        importFile: async (bytes) => {
          await pool.importDb(path, bytes);
          return openDb();
        },
      };
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 250));
    }
  }
  // Degraded mode, reported to the user: the driver says `persistent: false` and the shell
  // shows "data will not be saved". The warning keeps the cause for bug reports.
  console.warn("[@app/db] OPFS unavailable, using in-memory database:", lastErr);
  let current = memoryDb(sqlite3);
  return {
    db: wrap(current),
    persistent: false,
    exportFile: () => sqlite3.capi.sqlite3_js_db_export(current.pointer as number),
    importFile: (bytes) => {
      current = memoryDb(sqlite3, bytes);
      return Promise.resolve(wrap(current));
    },
  };
}

const handle = createRequestHandler(open);
const scope = self as unknown as {
  postMessage(msg: unknown, transfer: Transferable[]): void;
  onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null;
};
scope.onmessage = (ev) => {
  void handle(ev.data).then((res) =>
    scope.postMessage(res, res.ok ? collectTransferables(res.result) : []),
  );
};
