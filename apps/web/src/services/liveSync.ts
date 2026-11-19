/**
 * Sync on a device that keeps its own data (the desktop app, the browser's own storage): the
 * place, its credentials and the key stay in this device's storage, never in the synced data.
 * One sync runs at a time; while the app is open, `tick` syncs about once a minute.
 */
import type { KeyValueStorage } from "@app/ai";
import {
  type KenningRepository,
  type SyncKey,
  type SyncStore,
  fromBase64,
  keyFromRaw,
  openVault,
  readVault,
  syncOnce,
  toBase64,
} from "@app/db";
import type { DesktopSync } from "../desktop/bridge.js";
import { desktopFetch, folderStore } from "../sync/desktopStore.js";
import { githubStore } from "../sync/githubStore.js";
import { serverStore } from "../sync/serverStore.js";
import { webdavStore } from "../sync/webdavStore.js";
import type { SyncPlace, SyncServices, SyncStatus } from "./syncTypes.js";

const STORAGE_KEY = "kenning.sync";
/** Sync by itself at most this often. */
const AUTO_EVERY_MS = 60_000;

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

export function createLiveSync(deps: LiveSyncDeps) {
  const now = deps.now ?? Date.now;
  let running: Promise<unknown> | null = null;
  let lastAttempt = 0;

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

  async function run(saved: Saved, key: SyncKey, onProgress?: (m: string) => void) {
    const repo = deps.repo;
    if (!repo) throw new Error("Sync runs on a device with its own data.");
    lastAttempt = now();
    try {
      const r = await syncOnce(repo, storeFor(saved.place), key, {
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
      if (r.received > 0) deps.changed();
      return { status: status(next), received: r.received };
    } catch (e) {
      write({ ...saved, error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  }

  /** One sync at a time: a second call waits for the one running. */
  function once(
    onProgress?: (m: string) => void,
  ): Promise<{ status: SyncStatus; received: number }> {
    const saved = read();
    if (!saved) return Promise.reject(new Error("Sync is not set up on this device."));
    const p = (async () => run(saved, await keyFromRaw(fromBase64(saved.key)), onProgress))();
    running = p;
    void p
      .finally(() => {
        if (running === p) running = null;
      })
      .catch(() => undefined);
    return p;
  }

  const services: SyncServices = {
    async syncStatus() {
      return status(read());
    },

    async setUpSync(place, passphrase, deviceName, onProgress) {
      if (!deps.repo) throw new Error("Sync runs on a device with its own data.");
      const store = storeFor(place);
      onProgress?.("Opening your synced data");
      const created = !(await readVault(store));
      const key = await openVault(store, passphrase, true);
      const saved: Saved = {
        place,
        key: toBase64(key.raw),
        deviceName: deviceName.trim().slice(0, 60) || defaultName(),
        last: null,
        error: null,
        devices: [],
      };
      write(saved);
      const r = await run(saved, key, onProgress);
      return { ...r.status, created };
    },

    async syncNow(onProgress) {
      if (running) await running.catch(() => undefined);
      return (await once(onProgress)).status;
    },

    async stopSync() {
      if (running) await running.catch(() => undefined);
      write(null);
    },

    async pickSyncFolder() {
      return deps.desktop ? deps.desktop.pickFolder() : null;
    },
  };

  /**
   * Sync by itself (on focus, when visible and every half minute, at most once a minute).
   * True when changes came in. A failure is kept for Settings and thrown for the indicator.
   */
  async function tick(): Promise<boolean> {
    if (!read() || running || now() - lastAttempt < AUTO_EVERY_MS) return false;
    return (await once()).received > 0;
  }

  return { services, tick, configured: () => read() !== null };
}
