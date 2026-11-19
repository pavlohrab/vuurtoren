/** SQLite (wasm) in a worker for the browser: reading Anki packages and writing exports. */
import type { CreateSqlite, OpenSqlite } from "@app/anki";

export function browserSqlite(): { open: OpenSqlite; create: CreateSqlite; dispose: () => void } {
  const worker = new Worker(new URL("./sqlite.worker.ts", import.meta.url), { type: "module" });
  let seq = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  worker.onmessage = (ev: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
    const p = pending.get(ev.data.id);
    if (!p) return;
    pending.delete(ev.data.id);
    if (ev.data.error !== undefined) p.reject(new Error(ev.data.error));
    else p.resolve(ev.data.result);
  };
  const call = <T>(msg: Record<string, unknown>): Promise<T> =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      worker.postMessage({ id, ...msg });
    });
  const open: OpenSqlite = async (bytes) => {
    const db = await call<number>({ op: "open", bytes });
    return {
      all: (sql) => call<Record<string, unknown>[]>({ op: "all", db, sql }),
      close: () => call<void>({ op: "close", db }),
    };
  };
  const create: CreateSqlite = async () => {
    const db = await call<number>({ op: "create" });
    return {
      exec: (sql, params = []) => call<void>({ op: "run", db, sql, params: [...params] }),
      bytes: () => call<Uint8Array>({ op: "export", db }),
      close: () => call<void>({ op: "close", db }),
    };
  };
  return { open, create, dispose: () => worker.terminate() };
}
