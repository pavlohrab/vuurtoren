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
      return { db: wrap(new pool.OpfsSAHPoolDb(`/${name}.sqlite3`)), persistent: true };
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 250));
    }
  }
  console.warn("[@app/db] OPFS unavailable, using in-memory database:", lastErr);
  return { db: wrap(new sqlite3.oo1.DB(":memory:", "c")), persistent: false };
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
