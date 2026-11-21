/**
 * Where this device keeps its sync key (the 64 bytes that open the synced data), so it does not
 * sit in plain localStorage next to everything else a page script can read.
 *
 * - Desktop app: the system keychain (macOS Keychain, Windows Credential Manager, the Secret
 *   Service on Linux) through the app; a file only this user can read when there is none.
 * - Browser: IndexedDB holds the key encrypted (AES-GCM) with a wrapping key that is itself in
 *   IndexedDB as a non-extractable CryptoKey. Script on the page can still use it to decrypt,
 *   but the key bytes cannot be read out of the stored wrapping key, a copy of the profile's
 *   storage is not enough without the browser's own key handling, and nothing is in
 *   localStorage.
 *
 * Interface for the sync service:
 *
 *     const where = await saveSyncKey(key.raw, { desktop });   // after setting up or unlocking
 *     const raw = await loadSyncKey({ desktop });              // before each sync; null if none
 *     await forgetSyncKey({ desktop });                        // when sync is stopped
 *
 * `desktop` is the bridge's `sync` object (`desktopBridge()?.sync`); without it the browser
 * store is used. One key per device (and per browser profile and site).
 *
 * A device connected to a server with a pairing code keeps that server's sync token here too
 * (`saveSyncToken`, `loadSyncToken`, `forgetSyncToken`): the Android Keystore or the system
 * keychain in the app, the same wrapped record in a browser.
 */
import { fromBase64, toBase64 } from "@app/db";
import type { DesktopSync, SecretName } from "../desktop/bridge.js";

/**
 * Where the key went: the system keychain or a private file (a computer), the Android Keystore,
 * or the browser.
 */
type SyncKeyPlace = "keychain" | "file" | "keystore" | "browser";

/** One stored key, as kept in IndexedDB. */
export interface WrappedKey {
  /** AES-GCM, non-extractable: it can encrypt and decrypt, never be exported. */
  wrap: CryptoKey;
  iv: Uint8Array;
  sealed: ArrayBuffer;
}

/** The record storage behind the browser store (IndexedDB by default; a fake in tests). */
export interface WrappedKeyRecords {
  get(): Promise<WrappedKey | undefined>;
  put(record: WrappedKey): Promise<void>;
  delete(): Promise<void>;
}

export interface SyncKeyStoreDeps {
  /** The desktop app's sync bridge; when it can keep keys, it is used instead of the browser. */
  desktop?: DesktopSync | null | undefined;
  /** For tests: where the browser store keeps its record. */
  records?: WrappedKeyRecords;
}

type SecretDeps = SyncKeyStoreDeps & { name?: SecretName };

const DB_NAME = "vuurtoren-keys";
const STORE = "keys";
const RECORD = "sync";

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("The browser's key storage failed."));
  });
}

/** The browser's IndexedDB as the record storage (one database, one store, a record per secret). */
function indexedDbRecords(record: string, idb: IDBFactory = indexedDB): WrappedKeyRecords {
  const open = (): Promise<IDBDatabase> => {
    const r = idb.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    return request(r);
  };
  const run = async <T>(
    mode: IDBTransactionMode,
    f: (s: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const db = await open();
    try {
      return await request(f(db.transaction(STORE, mode).objectStore(STORE)));
    } finally {
      db.close();
    }
  };
  return {
    get: () => run("readonly", (s) => s.get(record) as IDBRequest<WrappedKey | undefined>),
    put: async (r) => void (await run("readwrite", (s) => s.put(r, record))),
    delete: async () => void (await run("readwrite", (s) => s.delete(record))),
  };
}

const keepsKeys = (
  d: DesktopSync | null | undefined,
): d is DesktopSync & Required<Pick<DesktopSync, "saveKey" | "loadKey" | "forgetKey">> =>
  !!d?.saveKey && !!d.loadKey && !!d.forgetKey;

const records = (deps: SecretDeps) =>
  deps.records ?? indexedDbRecords(deps.name === "sync-token" ? "sync-token" : RECORD);
/** The bridge's arguments: the sync key is named by naming nothing (older builds). */
const named = (deps: SecretDeps): [SecretName] | [] =>
  deps.name && deps.name !== "sync-key" ? [deps.name] : [];

/** Keep the sync key on this device, replacing any kept before. */
export async function saveSyncKey(raw: Uint8Array, deps: SecretDeps = {}): Promise<SyncKeyPlace> {
  if (keepsKeys(deps.desktop)) return deps.desktop.saveKey(toBase64(raw), ...named(deps));
  // A new wrapping key each time: an old record never shares one with the new.
  const wrap = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrap, raw as BufferSource);
  await records(deps).put({ wrap, iv, sealed });
  return "browser";
}

/** The kept sync key, or null when this device keeps none (or it can no longer be opened). */
export async function loadSyncKey(deps: SecretDeps = {}): Promise<Uint8Array | null> {
  if (keepsKeys(deps.desktop)) {
    const b64 = await deps.desktop.loadKey(...named(deps));
    return b64 ? fromBase64(b64) : null;
  }
  const record = await records(deps).get();
  if (!record) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: record.iv as BufferSource },
      record.wrap,
      record.sealed,
    );
    return new Uint8Array(plain);
  } catch {
    // A damaged record: as if there were none (the passphrase brings the key back).
    return null;
  }
}

/** Forget the sync key on this device. */
export async function forgetSyncKey(deps: SecretDeps = {}): Promise<void> {
  if (keepsKeys(deps.desktop)) return deps.desktop.forgetKey(...named(deps));
  await records(deps).delete();
}

const TOKEN = { name: "sync-token" } as const;

/** Keep a server's sync token (the device connected with a pairing code). */
export async function saveSyncToken(token: string, deps: SyncKeyStoreDeps = {}): Promise<void> {
  // A token is ASCII; as base64 it travels like the key.
  await saveSyncKey(new TextEncoder().encode(token), { ...deps, ...TOKEN });
}

/** The kept sync token, or null. */
export async function loadSyncToken(deps: SyncKeyStoreDeps = {}): Promise<string | null> {
  const raw = await loadSyncKey({ ...deps, ...TOKEN });
  return raw ? new TextDecoder().decode(raw) : null;
}

export async function forgetSyncToken(deps: SyncKeyStoreDeps = {}): Promise<void> {
  await forgetSyncKey({ ...deps, ...TOKEN });
}
