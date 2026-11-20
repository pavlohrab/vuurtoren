/**
 * Backup and restore helpers shared by every storage mode (browser worker, server API).
 * A backup is a plain SQLite file: the whole database, event log included. Everything here
 * is engine-agnostic (pure functions over bytes or a `SyncDb`), so it runs in a worker, in
 * Node and in tests.
 */
import type { SyncDb } from "./driver-core.js";
import { randomDeviceId } from "./ids.js";
import { SCHEMA_VERSION, SchemaTooNewError } from "./schema.js";
import type { SqlDriver } from "./types.js";

/** Tables every Kenning database has (schema v1 onwards); an upload without them is rejected. */
export const REQUIRED_TABLES = ["meta", "events"] as const;

/** First 16 bytes of every SQLite 3 file. */
const SQLITE_MAGIC = "SQLite format 3\u0000";
/** Size of the database header; `user_version` is the big-endian u32 at offset 60. */
const HEADER_BYTES = 100;
const USER_VERSION_OFFSET = 60;

/** A file offered as a backup is not usable. `message` is safe to show to the user. */
export class BackupError extends Error {
  override readonly name = "BackupError";
}

/** Facts about a database or backup file. */
export interface BackupFacts {
  userVersion: number;
  eventCount: number;
}

/** Size and content counters shown in Settings. */
export interface DataInfo {
  /** Database size in bytes (page count x page size). */
  sizeBytes: number;
  /** Number of events in the log. */
  eventCount: number;
  /** This installation's device id (null if unknown). */
  deviceId: string | null;
}

/**
 * Storage-agnostic backup/restore surface, implemented for the browser (OPFS worker) and for
 * the server (HTTP). `importBackup` replaces ALL current data; callers reload the app after it.
 */
export interface DataAdmin {
  info(): Promise<DataInfo>;
  /** A consistent snapshot of the whole database as a SQLite file. */
  exportBackup(): Promise<Uint8Array>;
  /** Replace the database with `bytes` (validated first; a new device id is assigned). */
  importBackup(bytes: Uint8Array): Promise<void>;
}

/**
 * Cheap check of the first bytes of a candidate backup: SQLite magic and a `user_version`
 * this build can read.
 * @returns the file's `user_version`
 * @throws BackupError if the bytes are not a SQLite file; SchemaTooNewError if it is too new
 */
export function checkBackupHeader(bytes: Uint8Array): number {
  if (bytes.length < HEADER_BYTES) throw new BackupError("This file is not a SQLite database.");
  for (let i = 0; i < SQLITE_MAGIC.length; i++) {
    if (bytes[i] !== SQLITE_MAGIC.charCodeAt(i)) {
      throw new BackupError("This file is not a SQLite database.");
    }
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const userVersion = view.getUint32(USER_VERSION_OFFSET, false);
  if (userVersion > SCHEMA_VERSION) throw new SchemaTooNewError(userVersion);
  if (userVersion < 1) throw new BackupError("This SQLite file is not a Kenning backup.");
  return userVersion;
}

/**
 * Deep check of an opened candidate: schema version, required tables, event count.
 * @throws BackupError / SchemaTooNewError
 */
export function inspectBackup(db: SyncDb): BackupFacts {
  const userVersion = Number(db.exec("PRAGMA user_version")[0]?.["user_version"] ?? 0);
  if (userVersion > SCHEMA_VERSION) throw new SchemaTooNewError(userVersion);
  const names = new Set(
    db.exec("SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => String(r["name"])),
  );
  for (const t of REQUIRED_TABLES) {
    if (!names.has(t)) throw new BackupError(`This SQLite file is not a Kenning backup (no ${t}).`);
  }
  const eventCount = Number(db.exec("SELECT count(*) AS c FROM events")[0]?.["c"] ?? 0);
  return { userVersion, eventCount };
}

/**
 * Make a freshly restored database safe to open: a NEW device id (so two devices restored
 * from the same backup never share one id) and no stored projection version, which makes the
 * repository rebuild every projection from the event log.
 *
 * Sync sends a device's own events (those with its device id). So that the backup's events not
 * yet sent still reach the other devices, they move to the new id (same event ids, so a device
 * that already has them skips them), and the sync bookkeeping marks the old id's events up to
 * the last one sent as already received. Without any sync bookkeeping, all of the old id's
 * events move: none were sent.
 */
export function prepareImported(db: SyncDb, deviceId: string = randomDeviceId()): string {
  const meta = (key: string): unknown => {
    const v = db.exec("SELECT value FROM meta WHERE key = ?", [key])[0]?.["value"];
    try {
      return typeof v === "string" ? (JSON.parse(v) as unknown) : null;
    } catch {
      return null;
    }
  };
  const oldId = meta("device_id");
  const state = meta("sync_state") as { sent?: unknown; received?: unknown } | null;
  if (typeof oldId === "string" && oldId !== deviceId) {
    const sent = state && typeof state.sent === "string" ? state.sent : "";
    // The log is append-only (no UPDATE): copy the unsent rows out, then back in with the new id.
    db.exec("DROP TABLE IF EXISTS temp.unsent");
    db.exec("CREATE TEMP TABLE unsent AS SELECT * FROM events WHERE device_id = ? AND id > ?", [
      oldId,
      sent,
    ]);
    db.exec("DELETE FROM events WHERE id IN (SELECT id FROM temp.unsent)");
    db.exec("UPDATE temp.unsent SET device_id = ?", [deviceId]);
    db.exec("INSERT INTO events SELECT * FROM temp.unsent");
    db.exec("DROP TABLE temp.unsent");
    if (state && typeof state === "object") {
      const received =
        state.received && typeof state.received === "object"
          ? (state.received as Record<string, string>)
          : {};
      const next = { ...state, received: sent ? { ...received, [oldId]: sent } : received };
      db.exec("UPDATE meta SET value = ? WHERE key = 'sync_state'", [JSON.stringify(next)]);
    }
  }
  db.exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('device_id', ?)", [
    JSON.stringify(deviceId),
  ]);
  db.exec("DELETE FROM meta WHERE key = 'projection_version'");
  return deviceId;
}

/** `kenning-YYYY-MM-DD.sqlite` (local date). */
export function backupFilename(date: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `kenning-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}.sqlite`;
}

/** Size (page count x page size) and event count of an open database. */
export async function databaseStats(
  driver: Pick<SqlDriver, "exec">,
): Promise<Pick<DataInfo, "sizeBytes" | "eventCount">> {
  const num = async (sql: string, col: string): Promise<number> =>
    Number((await driver.exec(sql))[0]?.[col] ?? 0);
  const pages = await num("PRAGMA page_count", "page_count");
  const pageSize = await num("PRAGMA page_size", "page_size");
  let eventCount = 0;
  try {
    eventCount = await num("SELECT count(*) AS c FROM events", "c");
  } catch {
    // Not a Kenning database (no events table): report zero.
  }
  return { sizeBytes: pages * pageSize, eventCount };
}
