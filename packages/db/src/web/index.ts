/**
 * Web driver entry ("@app/db/web"): SQLite (sqlite-wasm, opfs-sahpool VFS) in a dedicated
 * worker. Falls back to an in-memory database (`persistent === false`) when OPFS is
 * unavailable, e.g. in private browsing.
 */
import { type WebDriver, createWorkerDriver } from "./driver.js";

export type { WebDriver, WorkerLike } from "./driver.js";
export { createWorkerDriver } from "./driver.js";

/**
 * Start the worker and open the database.
 * @param name database name; the OPFS file is `/<name>.sqlite3`
 */
export function createWebDriver(name: string = "vuurtoren"): Promise<WebDriver> {
  // The literal `new Worker(new URL(..., import.meta.url), { type: "module" })` form is what
  // Vite/Rollup detect to bundle the worker and its wasm asset.
  const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  return createWorkerDriver(worker, name);
}
