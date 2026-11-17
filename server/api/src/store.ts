/**
 * The single database file of a Kenning server: one repository, one writer. Every operation
 * (rpc, info, export, import) runs through one queue, so an import can swap the file
 * atomically while no request is in flight.
 */
import {
  closeSync,
  copyFileSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  type DataInfo,
  type KenningRepository,
  type SqlDriver,
  SCHEMA_VERSION,
  SchemaTooNewError,
  checkBackupHeader,
  createRepository,
  databaseStats,
  inspectBackup,
  isSchemaTooNew,
  prepareImported,
} from "@app/db";
import { createNodeDriver, createNodeSyncDb } from "@app/db/node";

/** The first bytes of a file (the SQLite header), for a cheap check before opening it. */
function readHeader(file: string, n = 100): Uint8Array {
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(n);
    const got = readSync(fd, buf, 0, n, 0);
    return new Uint8Array(buf.buffer, buf.byteOffset, got);
  } finally {
    closeSync(fd);
  }
}

export interface Store {
  readonly path: string;
  /** "ready", or "schema-too-new" when the file needs a newer app (repository unavailable). */
  readonly state: "ready" | "schema-too-new";
  readonly foundVersion: number | undefined;
  /** Run `fn` with the repository, serialised with every other operation. */
  withRepo<T>(fn: (repo: KenningRepository) => Promise<T>): Promise<T>;
  info(): Promise<DataInfo>;
  /** Consistent snapshot as a file; call `cleanup` after streaming it. */
  snapshot(): Promise<{ file: string; cleanup: () => void }>;
  /** Replace the database with `bytes` (validated; new device id). */
  importBackup(bytes: Uint8Array): Promise<void>;
  /** A fresh temporary path next to the database, for streaming an upload into. */
  uploadPath(): string;
  /** Replace the database with the backup in `file` (from `uploadPath`; consumed). */
  importBackupFile(file: string): Promise<void>;
  close(): Promise<void>;
}

/** Open (creating if missing) the database at `path`. */
export async function openStore(path: string): Promise<Store> {
  let tail: Promise<unknown> = Promise.resolve();
  const queue = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => undefined);
    return run;
  };
  const tmpName = (tag: string): string =>
    join(dirname(path), `.${tag}-${randomBytes(6).toString("hex")}.tmp`);

  let driver: SqlDriver | null = null;
  let repo: KenningRepository | null = null;
  let state: Store["state"] = "ready";
  let foundVersion: number | undefined;

  async function open(): Promise<void> {
    const d = await createNodeDriver(path);
    try {
      repo = await createRepository(d);
      driver = d;
      state = "ready";
      foundVersion = undefined;
    } catch (err) {
      await d.close();
      driver = null;
      repo = null;
      if (!isSchemaTooNew(err)) throw err;
      state = "schema-too-new";
      foundVersion = err.found;
    }
  }
  await open();

  /** Validate the candidate file `tmp` (next to the database) and atomically swap it in. */
  async function swapIn(tmp: string): Promise<void> {
    try {
      const db = createNodeSyncDb(tmp);
      try {
        inspectBackup(db);
        prepareImported(db);
      } finally {
        db.close();
      }
      await driver?.close();
      driver = null;
      repo = null;
      // Rename is atomic on one filesystem (tmp lives next to the target).
      renameSync(tmp, path);
      for (const ext of ["-wal", "-shm", "-journal"]) rmSync(path + ext, { force: true });
    } finally {
      rmSync(tmp, { force: true });
      // Also reopens the old file when validation failed before the swap.
      if (!driver) await open();
    }
  }

  return {
    path,
    get state() {
      return state;
    },
    get foundVersion() {
      return foundVersion;
    },
    withRepo: (fn) =>
      queue(async () => {
        if (!repo) throw new SchemaTooNewError(foundVersion ?? SCHEMA_VERSION + 1);
        return fn(repo);
      }),
    info: () =>
      queue(async () => {
        if (driver && repo) return { ...(await databaseStats(driver)), deviceId: repo.deviceId };
        // Too-new file: read the counters directly.
        const raw = createNodeSyncDb(path);
        try {
          const num = (sql: string, col: string): number => Number(raw.exec(sql)[0]?.[col] ?? 0);
          const row = raw.exec("SELECT value FROM meta WHERE key = 'device_id'")[0];
          return {
            sizeBytes:
              num("PRAGMA page_count", "page_count") * num("PRAGMA page_size", "page_size"),
            eventCount: num("SELECT count(*) AS c FROM events", "c"),
            deviceId: row ? (JSON.parse(String(row["value"])) as string) : null,
          };
        } finally {
          raw.close();
        }
      }),
    snapshot: () =>
      queue(async () => {
        const file = tmpName("export");
        const cleanup = (): void => rmSync(file, { force: true });
        try {
          // The database is closed when too new, so a plain copy is consistent.
          if (driver) await driver.exec("VACUUM INTO ?", [file]);
          else copyFileSync(path, file);
        } catch (err) {
          cleanup();
          throw err;
        }
        return { file, cleanup };
      }),
    importBackup: (bytes) =>
      queue(async () => {
        checkBackupHeader(bytes);
        const tmp = tmpName("import");
        writeFileSync(tmp, bytes);
        await swapIn(tmp);
      }),
    uploadPath: () => tmpName("upload"),
    importBackupFile: (file) =>
      queue(async () => {
        try {
          checkBackupHeader(readHeader(file));
        } catch (err) {
          rmSync(file, { force: true });
          throw err;
        }
        await swapIn(file);
      }),
    close: () =>
      queue(async () => {
        await driver?.close();
        driver = null;
        repo = null;
      }),
  };
}
