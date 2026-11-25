/**
 * Sync on this device: the place, its credentials and the key stay in this device's storage,
 * never in the synced data. One thing runs at a time (setting up, a sync, unlocking, a
 * passphrase change, stopping).
 *
 * While the app is open, `auto` syncs: once at start, when the app comes back into view, every
 * 15 s while it is visible, and about 5 s after the last local change (the log's head is
 * watched every few seconds). `syncBeforeLeaving` sends what is not sent yet when the app is
 * hidden or closed.
 */
import type { KeyValueStorage } from "@app/ai";
import {
  type Argon2Cost,
  type SyncKey,
  type SyncProblem,
  type SyncStore,
  type VaultFile,
  type VuurtorenRepository,
  VAULT_PATH,
  changePassphrase,
  checkKey,
  createVault,
  fromBase64,
  keyFromRaw,
  toBase64,
  newRecoveryKey,
  readVault,
  syncOnce,
  unlockVault,
  vaultId,
} from "@app/db";
import type { DesktopSync } from "../desktop/bridge.js";
import { pairWithServer, pairedLabel, parseConnectLink } from "../sync/connect.js";
import { desktopFetch, folderStore } from "../sync/desktopStore.js";
import {
  forgetSyncKey,
  forgetSyncToken,
  loadSyncKey,
  loadSyncToken,
  saveSyncKey,
  saveSyncToken,
} from "../sync/keyStore.js";
import { placeLabel } from "../sync/labels.js";
import { serverStore } from "../sync/serverStore.js";
import { webdavStore } from "../sync/webdavStore.js";
import type { AutoSync, SetUpHow, SyncPlace, SyncServices, SyncStatus } from "./syncTypes.js";

const STORAGE_KEY = "vuurtoren.sync";
/** The server connected with a pairing code, until sync is set up with it. */
const PAIRED_KEY = "vuurtoren.sync.paired";
/** The timer pulls at most this often; after a failed sync nothing runs sooner. */
const PULL_EVERY_MS = 15_000;
/** Coming back into view right after a sync does not sync again. */
const MIN_GAP_MS = 5_000;
/** Local changes go out once the log has been quiet this long. */
const QUIET_MS = 5_000;
/** Problems listed in Settings. */
const PROBLEMS_KEPT = 20;

interface Saved {
  place: SyncPlace;
  deviceName: string;
  last: SyncStatus["last"];
  error: string | null;
  /** The key store had no key for this place. */
  needsKey?: boolean;
  devices: SyncStatus["devices"];
  problems?: SyncProblem[];
  /** Devices this one replaces (the same phone before a reinstall). */
  replaces?: string[];
}

/** Where this device keeps the sync key (the OS keychain, or protected browser storage). */
interface SyncKeys {
  save(raw: Uint8Array): Promise<unknown>;
  /** The key, or null when there is none; throws when the key store itself fails. */
  load(): Promise<Uint8Array | null>;
  forget(): Promise<void>;
}

/** Where this device keeps a server's sync token (connected with a pairing code). */
interface TokenKeeper {
  save(token: string): Promise<unknown>;
  load(): Promise<string | null>;
  forget(): Promise<void>;
}

/** The Vuurtoren server this page comes from: it can be the place. */
export interface ThisServer {
  origin: string;
  /** Make a sync token for this page; it may change the passphrase and recovery key. */
  newToken(label: string): Promise<string>;
}

export interface LiveSyncDeps {
  repo: VuurtorenRepository;
  /** Where the sync key is kept (default: the key store). */
  keys?: SyncKeys;
  storage: KeyValueStorage;
  fetch: typeof globalThis.fetch;
  /** The app's file and fetch bridge (folders and WebDAV on a computer, requests and keys). */
  desktop?: DesktopSync | undefined;
  /** The places this device can use (default: every place in the app, else a server). */
  places?: readonly SyncPlace["kind"][];
  /** The app brings its own language server (default: in the app). */
  bundledLanguageServer?: boolean;
  /** A phone: the token is listed as "Phone (<model>)". */
  phone?: boolean;
  /** The camera's QR scanner (phones). */
  scanQr?: (() => Promise<string | null>) | null | undefined;
  cancelScan?: (() => Promise<void>) | null | undefined;
  /** `vuurtoren://` links that opened the app (phones). */
  links?: { take(): Promise<string[]> } | null | undefined;
  /** Where a paired server's token is kept (default: the key store). */
  tokens?: TokenKeeper;
  /** The page comes from a Vuurtoren server, which can be the place. */
  server?: ThisServer | undefined;
  /** Changes came in from another device: drop what is derived from the data. */
  changed: () => void;
  now?: () => number;
  /** How hard the passphrase is to guess by trying (tests use a light one). */
  cost?: Argon2Cost;
}

/** This device has no sync key: the passphrase brings it back. */
class MissingKeyError extends Error {
  override readonly name = "MissingKeyError";
  constructor() {
    super("This device does not have its sync key. Type your passphrase to unlock sync.");
  }
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
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Write vault.json, then read it back: a place that did not keep it, or another device that
 * wrote its own at the same moment, shows here and not later as a lost recovery key.
 */
async function writeVault(store: SyncStore, vault: VaultFile): Promise<void> {
  await store.put(VAULT_PATH, encodeVault(vault));
  const back = await readVault(store);
  if (!back) {
    throw new Error(
      "The sync place did not keep the file just written. Check that Vuurtoren may write there, then try again.",
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

/** Anything Vuurtoren left in the place: device folders, images, a vault (or a copy of one). */
async function holdsVuurtorenData(store: SyncStore): Promise<boolean> {
  const top = await store.list("vuurtoren");
  if (top.some((n) => n.startsWith("vault"))) return true;
  if (top.includes("devices") && (await store.list("vuurtoren/devices")).length > 0) return true;
  return top.includes("blobs") && (await store.list("vuurtoren/blobs")).length > 0;
}

/** What was left out stays listed; what waits is replaced by this sync's view. */
function mergeProblems(before: SyncProblem[] = [], now: SyncProblem[]): SyncProblem[] {
  const kept = before.filter((p) => p.leftOut && !now.some((q) => q.what === p.what));
  return [...kept, ...now].slice(-PROBLEMS_KEPT);
}

const sameOrigin = (a: string, b: string): boolean => {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
};

export function createLiveSync(deps: LiveSyncDeps) {
  const now = deps.now ?? Date.now;
  const { repo } = deps;
  const keyDeps = { desktop: deps.desktop };
  const keys: SyncKeys = deps.keys ?? {
    save: (raw) => saveSyncKey(raw, keyDeps),
    load: () => loadSyncKey(keyDeps),
    forget: () => forgetSyncKey(keyDeps),
  };
  const tokens: TokenKeeper = deps.tokens ?? {
    save: (t) => saveSyncToken(t, keyDeps),
    load: () => loadSyncToken(keyDeps),
    forget: () => forgetSyncToken(keyDeps),
  };
  const places = deps.places ?? (deps.desktop ? ["server", "folder", "webdav"] : ["server"]);
  const bundledNlp = deps.bundledLanguageServer ?? !!deps.desktop;
  /** The kept token once read (the key store is asked once per start). */
  let keptToken: string | null = null;
  /** A connect link that opened the app, until connecting with it succeeds. */
  let pendingLink: string | null = null;
  let running: Promise<unknown> | null = null;
  let lastAttempt = 0;
  let lastFailed = false;
  /** The log's head after the last finished sync sent it all: unchanged means nothing to send. */
  let syncedAt: number | null = null;
  /** The head as last watched, and since when it is so (`auto("local")`). */
  let watched: { seq: number; since: number } | null = null;
  /** The leave-sync in progress. */
  let leaving: Promise<void> | null = null;
  /** The place's store, made once per place. */
  let built: { id: string; store: SyncStore } | null = null;

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
  const readPaired = (): string | null => {
    try {
      const raw = deps.storage.getItem(PAIRED_KEY);
      return raw ? ((JSON.parse(raw) as { url?: string }).url ?? null) : null;
    } catch {
      return null;
    }
  };
  const writePaired = (url: string | null) =>
    url
      ? deps.storage.setItem(PAIRED_KEY, JSON.stringify({ url }))
      : deps.storage.removeItem(PAIRED_KEY);

  /** The place with its token: a kept one comes from the key store. */
  async function withToken(place: SyncPlace): Promise<SyncPlace> {
    if (place.kind !== "server" || !place.kept) return place;
    keptToken ??= await tokens.load();
    if (!keptToken) {
      throw new Error(
        "This device no longer has its sync token for the server. Stop syncing, then connect to the server again (Settings → Your devices).",
      );
    }
    return { ...place, token: keptToken };
  }

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

  /** The place's store (made once per place), with a kept token read first. */
  async function storeOf(place: SyncPlace): Promise<SyncStore> {
    return storeFor(await withToken(place));
  }

  function storeFor(place: SyncPlace): SyncStore {
    const id = JSON.stringify(place);
    if (built?.id === id) return built.store;
    // In the desktop app requests go through the app: WebDAV servers rarely allow CORS.
    const pinned = place.kind === "server" ? place.pinned : undefined;
    if (pinned && !deps.desktop) throw new Error("Your computer can be reached from the app only.");
    const fetch = deps.desktop ? desktopFetch(deps.desktop, pinned) : deps.fetch;
    let store: SyncStore;
    switch (place.kind) {
      case "server":
        store = serverStore(place.url, place.token, fetch);
        break;
      case "webdav":
        if (!deps.desktop || !places.includes("webdav"))
          throw new Error("WebDAV can be chosen in the desktop app.");
        store = webdavStore(place.url, place.user, place.password, fetch);
        break;
      case "folder":
        if (!deps.desktop || !places.includes("folder"))
          throw new Error("A folder can be chosen in the desktop app.");
        store = folderStore(deps.desktop, place.path);
        break;
    }
    built = { id, store };
    return store;
  }

  /** The place as it is kept: on the page of that same server, with a token made for it. */
  async function keptPlace(place: SyncPlace, deviceName: string): Promise<SyncPlace> {
    if (place.kind !== "server" || place.token || place.kept || !deps.server) return place;
    if (!sameOrigin(place.url, deps.server.origin)) return place;
    const token = await deps.server.newToken(`${deviceName} (this browser)`);
    return { ...place, url: deps.server.origin, token };
  }

  function status(s: Saved | null): SyncStatus {
    return {
      desktop: places.includes("folder") || places.includes("webdav"),
      places: [...places],
      scan: !!deps.scanQr,
      paired: s ? null : readPaired(),
      thisServer: deps.server?.origin ?? null,
      place: s
        ? {
            kind: s.place.kind,
            label: placeLabel(s.place),
            ...(s.place.kind === "server" && s.place.pinned ? { computer: true } : {}),
          }
        : null,
      deviceName: s?.deviceName ?? defaultName(),
      last: s?.last ?? null,
      error: s?.error ?? null,
      needsKey: s?.needsKey ?? false,
      devices: s?.devices ?? [],
      problems: s?.problems ?? [],
    };
  }

  /** One sync. Whatever came in drops the caches, also when the sync fails after it. */
  async function run(saved: Saved, key: SyncKey, onProgress?: (m: string) => void) {
    lastAttempt = now();
    const before = (await repo.head()).seq;
    let applied = 0;
    // Count what is imported as it happens: a sync can fail after some files came in.
    const counting = new Proxy(repo, {
      get(target, prop, receiver) {
        if (prop !== "importEvents") return Reflect.get(target, prop, receiver) as unknown;
        return async (...args: Parameters<VuurtorenRepository["importEvents"]>) => {
          const r = await target.importEvents(...args);
          applied += r.added;
          return r;
        };
      },
    });
    try {
      const r = await syncOnce(counting, await storeOf(saved.place), key, {
        deviceName: saved.deviceName,
        ...(saved.replaces?.length ? { replaces: saved.replaces } : {}),
        now,
        ...(onProgress ? { onProgress } : {}),
      });
      const next: Saved = {
        ...saved,
        last: { at: now(), sent: r.sent, received: r.received },
        error: null,
        needsKey: false,
        devices: r.devices ?? saved.devices,
        problems: mergeProblems(saved.problems, r.problems),
      };
      write(next);
      // What came in moved the head too; a change made during the sync may not have gone out.
      const after = (await repo.head()).seq;
      syncedAt = after === before + applied ? after : before;
      lastFailed = false;
      return { status: status(next), applied };
    } catch (e) {
      lastFailed = true;
      write({ ...saved, error: messageOf(e) });
      throw Object.assign(e instanceof Error ? e : new Error(messageOf(e)), { applied });
    } finally {
      if (applied > 0) deps.changed();
    }
  }

  /** The kept key, or MissingKeyError (noted, so Settings asks for the passphrase). */
  async function loadKey(saved: Saved): Promise<SyncKey> {
    let raw: Uint8Array | null;
    try {
      raw = await keys.load();
    } catch (e) {
      lastFailed = true;
      lastAttempt = now();
      throw new Error(`The sync key could not be read on this device: ${messageOf(e)}`, {
        cause: e,
      });
    }
    if (!raw) {
      const missing = new MissingKeyError();
      write({ ...saved, error: missing.message, needsKey: true });
      throw missing;
    }
    return keyFromRaw(raw);
  }

  /** A sync with the saved place and key (inside `exclusive`). */
  async function once(onProgress?: (m: string) => void) {
    const saved = read();
    if (!saved) throw new Error("Sync is not set up on this device.");
    return run(saved, await loadKey(saved), onProgress);
  }

  /** The place and its vault and key, after `secret` (passphrase or recovery key) opened it. */
  async function opened(secret: string) {
    const saved = read();
    if (!saved) throw new Error("Sync is not set up on this device.");
    const store = await storeOf(saved.place);
    const vault = await readVault(store);
    if (!vault) throw new Error("The sync place no longer holds your Vuurtoren data.");
    const key = await unlockVault(vault, secret);
    return { saved, store, vault, key };
  }

  /**
   * Open the data in a place (join) or start new data there (start). The key is kept on this
   * device before a new vault is written, so no vault exists that no device can open.
   */
  async function connect(store: SyncStore, how: SetUpHow, passphrase: string | null) {
    const vault = await readVault(store);
    if (how === "join") {
      if (!vault) {
        throw new Error(
          "There is no Vuurtoren sync data in this place yet. If another device started it, check that this is the same place (folder or address); a synced folder can take a few minutes to bring the files. To begin here instead, choose Start new sync data here.",
        );
      }
      if (passphrase === null) throw new Error("Type the passphrase of your synced data.");
      const key = await unlockVault(vault, passphrase);
      await keys.save(key.raw);
      return { key, recoveryKey: null };
    }
    if (vault) {
      throw new Error(
        "This place already holds Vuurtoren sync data. Choose Join my synced data and type its passphrase.",
      );
    }
    if (await holdsVuurtorenData(store)) {
      throw new Error(
        "This place already holds files from other devices, but not yet the file that opens them. If they sync here, wait until everything has arrived and choose Join my synced data. To start over, remove the vuurtoren folder there first.",
      );
    }
    const made = await createVault(passphrase, deps.cost);
    await keys.save(made.key.raw);
    try {
      await writeVault(store, made.vault);
    } catch (e) {
      await keys.forget().catch(() => undefined);
      throw e;
    }
    return { key: made.key, recoveryKey: made.recoveryKey };
  }

  const services: SyncServices = {
    async syncStatus() {
      return status(read());
    },

    async setUpSync(place, how, passphrase, deviceName, onProgress) {
      return exclusive(async () => {
        const name = deviceName.trim().slice(0, 60) || defaultName();
        const kept = await keptPlace(place, name);
        const store = await storeOf(kept);
        onProgress?.(how === "join" ? "Opening your synced data" : "Starting your sync data");
        const { key, recoveryKey } = await connect(store, how, passphrase);
        const saved: Saved = {
          place: kept,
          deviceName: name,
          last: null,
          error: null,
          devices: [],
        };
        write(saved);
        writePaired(null);
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

    async replaceDevice(deviceId) {
      return exclusive(async () => {
        const saved = read();
        if (!saved) throw new Error("Sync is not set up on this device.");
        const next: Saved = {
          ...saved,
          replaces: [...new Set([...(saved.replaces ?? []), deviceId])],
        };
        write(next);
        return (await run(next, await loadKey(next))).status;
      });
    },

    async unlockSync(secret) {
      return exclusive(async () => {
        const { saved, key } = await opened(secret);
        await keys.save(key.raw);
        const back: Saved = { ...saved, needsKey: false, error: null };
        write(back);
        try {
          return (await run(back, key)).status;
        } catch {
          return status(read());
        }
      });
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
        await keys.forget();
        const place = read()?.place;
        if ((place?.kind === "server" && place.kept) || readPaired()) await tokens.forget();
        keptToken = null;
        writePaired(null);
        write(null);
        syncedAt = null;
        watched = null;
        built = null;
      });
    },

    async phoneHandover() {
      if (!read()) return null;
      const raw = await keys.load();
      return raw ? toBase64(raw) : null;
    },

    async startForPhones(folder, deviceName) {
      return exclusive(async () => {
        const now = read();
        if (now) {
          // A folder already (this one, or Syncthing's): the phones join it.
          if (now.place.kind === "folder")
            return { ...status(now), recoveryKey: null, folder: now.place.path };
          throw new Error(
            "This computer syncs through another place. On your phone, choose that same place in Settings → Your devices.",
          );
        }
        const place: SyncPlace = { kind: "folder", path: folder };
        const store = storeFor(place);
        const { key, recoveryKey } = await connect(store, "start", null);
        const saved: Saved = {
          place,
          deviceName: deviceName.trim().slice(0, 60) || defaultName(),
          last: null,
          error: null,
          devices: [],
        };
        write(saved);
        try {
          await run(saved, key);
        } catch {
          // Kept in the saved status.
        }
        return { ...status(read()), recoveryKey, folder };
      });
    },

    async connectServer(link, deviceName) {
      return exclusive(async () => {
        const now = read();
        // The same computer at a new address (its certificate is the same): only the address
        // changes, the phone stays paired.
        if (
          now?.place.kind === "server" &&
          now.place.pinned &&
          "pinned" in link &&
          link.pinned === now.place.pinned
        ) {
          const moved: Saved = {
            ...now,
            place: { ...now.place, url: link.server.replace(/\/+$/, "") },
          };
          write(moved);
          const key = await keys.load();
          if (key) {
            try {
              await run(moved, await keyFromRaw(key));
            } catch {
              // Kept in the saved status.
            }
          }
          return status(read());
        }
        if (now) throw new Error("Stop syncing first, then connect to another server.");
        // In the app the request goes through it (no CORS setup on the server).
        const pinned = "pinned" in link ? link.pinned : undefined;
        const fetch = deps.desktop ? desktopFetch(deps.desktop, pinned) : deps.fetch;
        const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
        const label = pairedLabel(deviceName || defaultName(), ua, deps.phone ?? false);
        const paired = await pairWithServer(link, label, fetch);
        await tokens.save(paired.token);
        keptToken = paired.token;
        pendingLink = null;
        if (!pinned || !paired.key) {
          writePaired(paired.url);
          return status(null);
        }
        // "Connect a phone": the computer handed over the key, so the phone joins at once.
        const place: SyncPlace = {
          kind: "server",
          url: paired.url,
          token: "",
          kept: true,
          pinned,
        };
        const store = await storeOf(place);
        const vault = await readVault(store);
        if (!vault) throw new Error("Your computer has no sync data yet. Show the code again.");
        const key = await keyFromRaw(fromBase64(paired.key));
        await checkKey(vault, key);
        await keys.save(key.raw);
        const saved: Saved = {
          place,
          deviceName: (deviceName || defaultName()).trim().slice(0, 60),
          last: null,
          error: null,
          devices: [],
        };
        write(saved);
        writePaired(null);
        try {
          await run(saved, key);
        } catch {
          // Kept in the saved status; it tries again by itself.
        }
        return status(read());
      });
    },

    async scanConnectLink() {
      return deps.scanQr ? deps.scanQr() : null;
    },

    async cancelScan() {
      await deps.cancelScan?.();
    },

    async pendingConnectLink() {
      const links = (await deps.links?.take()) ?? [];
      pendingLink = links.filter((l) => parseConnectLink(l)).at(-1) ?? pendingLink;
      return pendingLink;
    },

    async pickSyncFolder() {
      return deps.desktop ? deps.desktop.pickFolder() : null;
    },

    syncBeforeLeaving() {
      // Hidden, then closed: both ask, one sync answers.
      leaving ??= leave().finally(() => (leaving = null));
      return leaving;
    },
  };

  /** Send what is not sent yet, if anything (never throws). */
  async function leave(): Promise<void> {
    const saved = read();
    if (!saved || saved.needsKey) return;
    if (syncedAt !== null && (await repo.head()).seq === syncedAt) return;
    try {
      await exclusive(() => once());
    } catch {
      // Kept in the saved status; the next sync tries again.
    }
  }

  /** Should `why` sync now? */
  async function due(why: AutoSync): Promise<boolean> {
    const since = now() - lastAttempt;
    if (lastFailed && since < PULL_EVERY_MS) return false;
    switch (why) {
      case "start":
        return true;
      case "focus":
        return since >= MIN_GAP_MS;
      case "timer":
        return since >= PULL_EVERY_MS;
      case "local": {
        const seq = (await repo.head()).seq;
        if (seq === syncedAt) {
          watched = null;
          return false;
        }
        if (watched?.seq !== seq) {
          watched = { seq, since: now() };
          return false;
        }
        return now() - watched.since >= QUIET_MS;
      }
    }
  }

  /**
   * Sync by itself when `why` makes it due. `ran`: a sync ran; `changed`: changes came in (also
   * when the sync failed after them); `error`: why it failed, or null.
   */
  async function auto(why: AutoSync): Promise<{ ran: boolean; changed: boolean; error: unknown }> {
    const saved = read();
    if (!saved || saved.needsKey || running || !(await due(why))) {
      return { ran: false, changed: false, error: null };
    }
    try {
      return { ran: true, changed: (await exclusive(() => once())).applied > 0, error: null };
    } catch (e) {
      return { ran: true, changed: ((e as { applied?: number }).applied ?? 0) > 0, error: e };
    }
  }

  /**
   * The language server of the server this device syncs with, for a device without one of its
   * own: the place's `/nlp` and its sync token. Null for other places and on the page of that
   * same server (it reaches `/nlp` with its sign-in).
   */
  async function languageServer(): Promise<{
    url: string;
    token: string;
    fetch?: typeof globalThis.fetch;
  } | null> {
    if (bundledNlp) return null;
    const saved = read()?.place;
    const pairedUrl = saved ? null : readPaired();
    const place: SyncPlace | undefined =
      saved ?? (pairedUrl ? { kind: "server", url: pairedUrl, token: "", kept: true } : undefined);
    if (place?.kind !== "server") return null;
    const here = deps.server?.origin ?? (typeof location === "undefined" ? "" : location.origin);
    if (sameOrigin(place.url, here)) return null;
    let token: string;
    try {
      token = place.kept ? ((await withToken(place)) as { token: string }).token : place.token;
    } catch {
      return null;
    }
    return {
      url: `${place.url.replace(/\/+$/, "")}/nlp`,
      token,
      // In the app the requests go through it, like sync's (no CORS setup on the server); to
      // the user's own computer only with its certificate (Connect a phone).
      ...(deps.desktop ? { fetch: desktopFetch(deps.desktop, place.pinned) } : {}),
    };
  }

  return { services, auto, languageServer, configured: () => read() !== null };
}
