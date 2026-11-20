/**
 * Node driver on the built-in `node:sqlite` (tests, the MCP server). Import from
 * "@app/db/node"; never from the package root (keeps `node:sqlite` out of browser bundles).
 */
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { type SyncDb, type SqlRow, driverFromSync } from "./driver-core.js";
import type { SqlDriver, SqlValue } from "./types.js";

export interface NodeDbOptions {
  /** Open the file read-only (another app may be writing it). */
  readOnly?: boolean;
}

/** Synchronous `SyncDb` over `node:sqlite` (also used by the web-worker protocol tests). */
export function createNodeSyncDb(path: string = ":memory:", opts: NodeDbOptions = {}): SyncDb {
  // Wait for another connection's write instead of failing at once (the desktop app may hold
  // the file). The journal mode stays whatever the file has.
  const db = new DatabaseSync(path, { readOnly: opts.readOnly ?? false, timeout: 5000 });
  return {
    exec(sql: string, params: readonly SqlValue[] = []): SqlRow[] {
      const stmt = db.prepare(sql);
      if (stmt.columns().length > 0) {
        return stmt.all(...(params as SQLInputValue[])) as SqlRow[];
      }
      // No result columns: run for effect. db.exec handles scripts but not binds.
      if (params.length > 0) stmt.run(...(params as SQLInputValue[]));
      else db.exec(sql);
      return [];
    },
    close: () => db.close(),
  };
}

/**
 * Open a SQLite database with `node:sqlite`.
 * @param path file path or ":memory:" (default)
 */
export function createNodeDriver(
  path: string = ":memory:",
  opts: NodeDbOptions = {},
): Promise<SqlDriver> {
  return Promise.resolve(driverFromSync(createNodeSyncDb(path, opts)));
}
