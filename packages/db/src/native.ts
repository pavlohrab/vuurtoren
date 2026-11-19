/**
 * Native driver ("@app/db/native"): the SQLite file of the desktop app, opened by the app
 * itself (apps/desktop, `db.rs`, rusqlite). Every statement crosses the app's IPC as JSON; this
 * module encodes what JSON cannot carry: blobs as `{"$b": base64}` and integers beyond 2^53 as
 * `{"$i": "123"}` (both directions). Schema, migrations and projections are the shared ones
 * (`createRepository`), exactly as with the browser worker.
 */
import { checkBackupHeader } from "./backup.js";
import { makeDriver, type SqlRow } from "./driver-core.js";
import { randomDeviceId } from "./ids.js";
import { SCHEMA_VERSION } from "./schema.js";
import type { SqlDriver, SqlValue } from "./types.js";

/** What the app offers (`window.__KENNING_DESKTOP__.db`, apps/desktop/src-tauri/src/bridge.js). */
export interface NativeDb {
  exec(sql: string, params: unknown[]): Promise<unknown[]>;
  close(): Promise<void>;
  /** The whole database file (raw bytes). */
  exportFile(): Promise<ArrayBuffer | Uint8Array>;
  /** Replace the database with a backup; the app validates it and sets the new device id. */
  importFile(bytes: Uint8Array, deviceId: string, maxSchema: number): Promise<void>;
}

/** The driver plus backup/restore (the same surface `createBrowserAdmin` uses). */
export type NativeDriver = SqlDriver & {
  readonly persistent: true;
  exportFile(): Promise<Uint8Array>;
  importFile(bytes: Uint8Array): Promise<void>;
};

const SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** A parameter as JSON. */
export function encodeParam(v: SqlValue): unknown {
  if (v instanceof Uint8Array) return { $b: toBase64(v) };
  if (typeof v === "bigint") return v >= -SAFE && v <= SAFE ? Number(v) : { $i: v.toString() };
  return v;
}

/** One JSON value from the app back to a SQL value. */
export function decodeValue(v: unknown): SqlValue {
  if (v === null || typeof v === "string" || typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "object") {
    const o = v as { $b?: unknown; $i?: unknown };
    if (typeof o.$b === "string") return fromBase64(o.$b);
    if (typeof o.$i === "string") return BigInt(o.$i);
  }
  throw new Error(`Unexpected value from the database: ${JSON.stringify(v)}`);
}

export function decodeRow(row: unknown): SqlRow {
  const out: SqlRow = {};
  for (const [k, v] of Object.entries(row as Record<string, unknown>)) out[k] = decodeValue(v);
  return out;
}

const asError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));

/** Wrap the app's database commands as a `SqlDriver` (single connection, serialised by the repo). */
export function createNativeDriver(native: NativeDb): NativeDriver {
  const driver = makeDriver(
    async (sql, params = []) => {
      try {
        const rows = await native.exec(sql, params.map(encodeParam));
        return rows.map(decodeRow);
      } catch (e) {
        throw asError(e);
      }
    },
    () => native.close(),
  );
  return Object.assign(driver, {
    persistent: true as const,
    async exportFile(): Promise<Uint8Array> {
      const bytes = await native.exportFile();
      return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    },
    async importFile(bytes: Uint8Array): Promise<void> {
      // Same first check as the browser worker; the app does the deep check on the file.
      checkBackupHeader(bytes);
      try {
        await native.importFile(bytes, randomDeviceId(), SCHEMA_VERSION);
      } catch (e) {
        throw asError(e);
      }
    },
  });
}
