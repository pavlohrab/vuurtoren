/**
 * Sync on a device that keeps its own data (the desktop app, the browser's own storage): the
 * place, its credentials and the key stay in this device's storage, never in the synced data.
 * One thing runs at a time (setting up, a sync, a passphrase change, stopping); while the app is
 * open, `tick` syncs about once a minute, and `syncBeforeLeaving` sends the last changes when
 * the app is hidden or closed.
 */
import type { KeyValueStorage } from "@app/ai";
import {
  type Argon2Cost,
  type KenningRepository,
  type SyncKey,
  type SyncStore,
  type VaultFile,
  VAULT_PATH,
  changePassphrase,
  createVault,
  fromBase64,
  keyFromRaw,
  newRecoveryKey,
  readVault,
  unlockVault,
  syncOnce,
  toBase64,
  vaultId,
} from "@app/db";
import type { DesktopSync } from "../desktop/bridge.js";
import { desktopFetch, folderStore } from "../sync/desktopStore.js";
import { githubStore } from "../sync/githubStore.js";
import { serverStore } from "../sync/serverStore.js";
import { webdavStore } from "../sync/webdavStore.js";
import type { SetUpHow, SyncPlace, SyncServices, SyncStatus } from "./syncTypes.js";

const STORAGE_KEY = "kenning.sync";
/** Sync by itself at most this often. */
const AUTO_EVERY_MS = 60_000;
/** Hiding the app syncs at most this often (switching windows back and forth does not). */
const LEAVE_EVERY_MS = 15_000;

interface Saved {
  place: SyncPlace;
  /** The 64 key bytes (base64): the passphrase itself is never kept. */
  key: string;
  deviceName: string;
  last: SyncStatus["last"];
  error: string | null;
  devices: SyncStatus["devices"];
}

export interface LiveSyncDeps {
  /** This device's own log; null on a page of a Kenning server (sync does not apply). */
  repo: KenningRepository | null;
  storage: KeyValueStorage;
  fetch: typeof globalThis.fetch;
  /** The desktop app's file and fetch bridge (folders; places without CORS). */
  desktop?: DesktopSync | undefined;
  /** Changes came in from another device: drop what is derived from the data. */
  changed: () => void;
  now?: () => number;
  /** How hard the passphrase is to guess by trying (tests use a light one). */
  cost?: Argon2Cost;
}

/** A name for this device until the learner gives one. */
function defaultName(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Android|iPhone|iPad/i.test(ua)) return "Phone";
  if (/Mac/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows computer";
  if (/Linux/i.test(ua)) return "Linux computer";
  return "This device";
}

const encodeVault = (v: VaultFile) => new TextEncoder().encode(JSON.stringify(v));

/**
 * Write vault.json, then read it back: a place that did not keep it, or another device that
 * wrote its own at the same moment, shows here and not later as a lost recovery key.
 */
async function writeVault(store: SyncStore, vault: VaultFile): Promise<void> {
  await store.put(VAULT_PATH, encodeVault(vault));
  const back = await readVault(store);
  if (!back) {
    throw new Error(
      "The sync place did not keep the file just written. Check that Kenning may write there, then try again.",
    );
  }
  if (JSON.stringify(back) !== JSON.stringify(vault)) {
    throw new Error(
      vaultId(back) === vaultId(vault)
        ? "Another device changed the passphrase or recovery key at the same moment. Try again."
        : "Another device started sync data in this place at the same moment. Choose Join my synced data instead.",
    );
  }
}

/** Anything Kenning left in the place: device folders, images, a vault (or a copy of one). */
async function holdsKenningData(store: SyncStore): Promise<boolean> {
  const top = await store.list("kenning");
  if (top.some((n) => n.startsWith("vault"))) return true;
  if (top.includes("devices") && (await store.list("kenning/devices")).length > 0) return true;
  return top.includes("blobs") && (await store.list("kenning/blobs")).length > 0;
}

export function createLiveSync(deps: LiveSyncDeps) {
  const now = deps.now ?? Date.now;
  let running: Promise<unknown> | null = null;
  let lastAttempt = 0;
  /** The log's position after the last sync that finished: unchanged means nothing to send. */
  let syncedAt: number | null = null;

  const read = (): Saved | null => {
    try {
      const raw = deps.storage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Saved) : null;
    } catch {
      return null;
    }
  };
  const write = (s: Saved | null) =>
    s ? deps.storage.setItem(STORAGE_KEY, JSON.stringify(s)) : deps.storage.removeItem(STORAGE_KEY);

  /** Run one thing at a time: a call waits for the one running, then runs. */
  async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    while (running) await running.catch(() => undefined);
    const p = fn();
    running = p;
    try {
      return await p;
    } finally {
      if (running === p) running = null;
    }
  }

  function storeFor(place: SyncPlace): SyncStore {
    // In the desktop app requests go through the app: WebDAV servers rarely allow CORS.
    const fetch = deps.desktop ? desktopFetch(deps.desktop) : deps.fetch;
    switch (place.kind) {
      case "server":
        return serverStore(place.url, place.token, fetch);
      case "webdav":
        return webdavStore(place.url, place.user, place.password, fetch);
      case "github":
        return githubStore(place.repo, place.token, deps.fetch, place.branch);
      case "folder":
        if (!deps.desktop) throw new Error("A folder can be chosen in the desktop app.");
        return folderStore(deps.desktop, place.path);
    }
  }

  function status(s: Saved | null): SyncStatus {
    return {
      available: deps.repo !== null,
      folders: !!deps.desktop,
      place: s ? { kind: s.place.kind, label: storeFor(s.place).label } : null,
      deviceName: s?.deviceName ?? defaultName(),
      last: s?.last ?? null,
      error: s?.error ?? null,
      devices: s?.devices ?? [],
    };
  }

  /** One sync. Whatever came in before a failure still drops the caches. */
  async function run(saved: Saved, key: SyncKey, onProgress?: (m: string) => void) {
    const repo = deps.repo;
    if (!repo) throw new Error("Sync runs on a device with its own data.");
    lastAttempt = now();
    let applied = 0;
    // Count what is imported as it happens: a sync can fail after some files came in.
    const counting = new Proxy(repo, {
      get(target, prop, receiver) {
        if (prop !== "importEvents") return Reflect.get(target, prop, receiver) as unknown;
        return async (...args: Parameters<KenningRepository["importEvents"]>) => {
          const r = await target.importEvents(...args);
          applied += r.added;
          return r;
        };
      },
    });
    try {
      const r = await syncOnce(counting, storeFor(saved.place), key, {
        deviceName: saved.deviceName,
        now,
        ...(onProgress ? { onProgress } : {}),
      });
      const next: Saved = {
        ...saved,
        last: { at: now(), sent: r.sent, received: r.received },
        error: null,
        devices: r.devices,
      };
      write(next);
      syncedAt = (await repo.head()).seq;
      return { status: status(next), received: r.received };
    } catch (e) {
      write({ ...saved, error: e instanceof Error ? e.message : String(e) });
      throw e;
    } finally {
      if (applied > 0) deps.changed();
    }
  }

  /** A sync with the saved place and key (inside `exclusive`). */
  async function once(onProgress?: (m: string) => void) {
    const saved = read();
    if (!saved) throw new Error("Sync is not set up on this device.");
    return run(saved, await keyFromRaw(fromBase64(saved.key)), onProgress);
  }

  /** The place and its vault and key, after `secret` (passphrase or recovery key) opened it. */
  async function opened(secret: string) {
    const saved = read();
    if (!saved) throw new Error("Sync is not set up on this device.");
    const store = storeFor(saved.place);
    const vault = await readVault(store);
    if (!vault) throw new Error("The sync place no longer holds your Kenning data.");
    const key = await unlockVault(vault, secret);
    return { store, vault, key };
  }

  /** Open the data in a place (join) or start new data there (start). */
  async function connect(store: SyncStore, how: SetUpHow, passphrase: string) {
    const vault = await readVault(store);
    if (how === "join") {
      if (!vault) {
        throw new Error(
          "There is no Kenning sync data in this place yet. If another device started it, check that this is the same place (folder, address, repository and branch); a synced folder can take a few minutes to bring the files. To begin here instead, choose Start new sync data here.",
        );
      }
      return { key: await unlockVault(vault, passphrase), recoveryKey: null };
    }
    if (vault) {
      throw new Error(
        "This place already holds Kenning sync data. Choose Join my synced data and type its passphrase.",
      );
    }
    if (await holdsKenningData(store)) {
      throw new Error(
        "This place already holds files from other devices, but not yet the file that opens them. If they sync here, wait until everything has arrived and choose Join my synced data. To start over, remove the kenning folder there first.",
      );
    }
    const made = await createVault(passphrase, deps.cost);
    await writeVault(store, made.vault);
    return { key: made.key, recoveryKey: made.recoveryKey };
  }

  const services: SyncServices = {
    async syncStatus() {
      return status(read());
    },

    async setUpSync(place, how, passphrase, deviceName, onProgress) {
      if (!deps.repo) throw new Error("Sync runs on a device with its own data.");
      return exclusive(async () => {
        const store = storeFor(place);
        onProgress?.(how === "join" ? "Opening your synced data" : "Starting your sync data");
        const { key, recoveryKey } = await connect(store, how, passphrase);
        const saved: Saved = {
          place,
          key: toBase64(key.raw),
          deviceName: deviceName.trim().slice(0, 60) || defaultName(),
          last: null,
          error: null,
          devices: [],
        };
        write(saved);
        // Sync is set up from here on: a first sync that does not finish is kept as the error
        // (it tries again by itself), and a new recovery key is still shown.
        try {
          await run(saved, key, onProgress);
        } catch {
          // Kept in the saved status.
        }
        return { ...status(read()), created: recoveryKey !== null, recoveryKey };
      });
    },

    async syncNow(onProgress) {
      return (await exclusive(() => once(onProgress))).status;
    },

    async changeSyncPassphrase(current, next) {
      await exclusive(async () => {
        const { store, vault, key } = await opened(current);
        await writeVault(store, await changePassphrase(vault, key, next, deps.cost));
      });
    },

    async newSyncRecoveryKey(current) {
      return exclusive(async () => {
        const { store, vault, key } = await opened(current);
        const made = await newRecoveryKey(vault, key, deps.cost);
        await writeVault(store, made.vault);
        return made.recoveryKey;
      });
    },

    async stopSync() {
      // After whatever runs (a setup too): nothing turns sync back on behind it.
      await exclusive(async () => {
        write(null);
        syncedAt = null;
      });
    },

    async pickSyncFolder() {
      return deps.desktop ? deps.desktop.pickFolder() : null;
    },

    async syncBeforeLeaving() {
      if (!read() || !deps.repo || running || now() - lastAttempt < LEAVE_EVERY_MS) return;
      if (syncedAt !== null && (await deps.repo.head()).seq === syncedAt) return;
      try {
        await exclusive(() => once());
      } catch {
        // Kept in the saved status; the next sync tries again.
      }
    },
  };

  /**
   * Sync by itself (on focus, when visible and every half minute, at most once a minute).
   * True when changes came in. A failure is kept for Settings and thrown for the indicator.
   */
  async function tick(): Promise<boolean> {
    if (!read() || running || now() - lastAttempt < AUTO_EVERY_MS) return false;
    return (await exclusive(() => once())).received > 0;
  }

  return { services, tick, configured: () => read() !== null };
}
