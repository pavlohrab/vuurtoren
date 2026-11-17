/**
 * Main-thread side of the web driver: a promise-based RPC client for the SQLite worker.
 * Kept free of worker construction so it can be tested with a fake worker.
 */
import { makeDriver } from "../driver-core.js";
import type { SqlDriver } from "../types.js";
import type { WorkerRequest, WorkerResponse, WorkerResult } from "./protocol.js";

/** The subset of `Worker` the client needs. */
export interface WorkerLike {
  postMessage(message: WorkerRequest): void;
  addEventListener(type: "message", fn: (ev: { data: WorkerResponse }) => void): void;
  addEventListener(type: "error", fn: (ev: { message?: string }) => void): void;
  terminate(): void;
}

/** A driver plus whether data survives a reload. */
export type WebDriver = SqlDriver & {
  readonly persistent: boolean;
  /**
   * Synchronously kill the worker, releasing OPFS access handles immediately. For `pagehide`:
   * an async close may not finish before the page is torn down or frozen. Committed writes
   * are already durable; an in-flight transaction is lost (as on a crash).
   */
  terminate(): void;
  /** The database file as bytes. Call through `repo.exclusive` so no transaction is open. */
  exportFile(): Promise<Uint8Array>;
  /**
   * Replace the database with a backup (validated in the worker; the old data is restored if
   * the file is rejected). Assigns a new device id. Reload the app afterwards.
   */
  importFile(bytes: Uint8Array): Promise<void>;
};

/**
 * Drive a SQLite worker over the request/response protocol.
 * Rejects pending calls if the worker errors or is closed.
 */
export async function createWorkerDriver(worker: WorkerLike, name: string): Promise<WebDriver> {
  let nextId = 1;
  let dead: Error | null = null;
  const pending = new Map<
    number,
    { resolve: (r: WorkerResult) => void; reject: (e: Error) => void }
  >();

  const failAll = (err: Error): void => {
    dead = err;
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  };
  worker.addEventListener("message", (ev) => {
    const msg = ev.data;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error(msg.error));
  });
  worker.addEventListener("error", (ev) => failAll(new Error(ev.message ?? "Worker error")));

  const call = (req: DistributiveOmitId<WorkerRequest>): Promise<WorkerResult> => {
    if (dead) return Promise.reject(dead);
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ ...req, id } as WorkerRequest);
    });
  };

  const opened = (await call({ op: "open", name })) as { persistent: boolean };
  const driver = makeDriver(
    async (sql, params = []) => {
      const rows = await call({ op: "exec", sql, params });
      return Array.isArray(rows) ? rows : [];
    },
    async () => {
      try {
        await call({ op: "close" });
      } finally {
        worker.terminate();
        failAll(new Error("Driver closed"));
      }
    },
    { persistent: opened.persistent },
  );
  const terminate = (): void => {
    if (dead) return;
    worker.terminate();
    failAll(new Error("Driver terminated"));
  };
  const exportFile = async (): Promise<Uint8Array> => {
    const r = await call({ op: "export" });
    if (!(r instanceof Uint8Array)) throw new Error("Export failed");
    return r;
  };
  const importFile = async (bytes: Uint8Array): Promise<void> => {
    await call({ op: "import", bytes });
  };
  return Object.assign(driver, { terminate, exportFile, importFile }) as WebDriver;
}

type DistributiveOmitId<T> = T extends unknown ? Omit<T, "id"> : never;
