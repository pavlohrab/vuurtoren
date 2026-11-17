/**
 * Pieces shared by every driver: a synchronous-engine interface, and the generic
 * transaction logic that turns an `exec` function into a full `SqlDriver`.
 */
import type { SqlDriver, SqlValue } from "./types.js";

export type SqlRow = Record<string, SqlValue>;

/** A synchronous SQLite handle (node:sqlite, or sqlite-wasm inside the worker). */
export interface SyncDb {
  exec(sql: string, params?: readonly SqlValue[]): SqlRow[];
  close(): void;
}

/**
 * Build a `SqlDriver` from a raw exec/close pair. `transaction` issues BEGIN/COMMIT and
 * ROLLBACK on throw. Nested calls join the outer transaction. Callers must not run
 * concurrent transactions on one driver (the repository serialises its calls).
 * `extra` properties are merged onto the driver (e.g. `persistent`).
 */
export function makeDriver(
  exec: SqlDriver["exec"],
  close: () => Promise<void>,
  extra: object = {},
): SqlDriver {
  let depth = 0;
  return {
    exec,
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      if (depth > 0) return fn();
      await exec("BEGIN IMMEDIATE");
      depth++;
      try {
        const result = await fn();
        await exec("COMMIT");
        return result;
      } catch (err) {
        await exec("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        depth--;
      }
    },
    close,
    ...extra,
  };
}

/** Wrap a synchronous engine as an async driver. */
export function driverFromSync(db: SyncDb): SqlDriver {
  return makeDriver(
    (sql, params) => {
      try {
        return Promise.resolve(db.exec(sql, params));
      } catch (err) {
        return Promise.reject(err instanceof Error ? err : new Error(String(err)));
      }
    },
    () => {
      db.close();
      return Promise.resolve();
    },
  );
}
