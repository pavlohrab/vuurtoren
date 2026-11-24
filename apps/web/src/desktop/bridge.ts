/**
 * The app (apps/desktop, Tauri: a computer or an Android phone) injects
 * `window.__VUURTOREN_DESKTOP__` into its bundled page. In a normal browser it is absent and
 * nothing here changes behaviour. What a device offers is read through `../platform/`.
 */
import type { NativeDb } from "@app/db/native";
import type { EntryResult } from "@app/nlp-client";

/** Who has the database file open (the lock file next to it, `db.rs`). */
export interface DbLock {
  host: string;
  pid: number;
  /** Unix seconds: opened, and last sign of life (refreshed every minute). */
  since: number;
  seen: number;
}

interface DbOpened {
  /** The database file (`~/Documents/Vuurtoren/vuurtoren.sqlite` by default). */
  path: string;
  /** True on the very first start (the file was just created). */
  created: boolean;
  /** Sync-tool conflict copies next to the file. */
  conflicts: string[];
  /** Another computer has the file open; nothing was opened. */
  locked: DbLock | null;
}

/** The bundled language server's `/health`, as far as the app uses it. */
interface SidecarHealth {
  ocr?: boolean;
  analyzerVersion?: string;
  packs?: {
    busy: boolean;
    items: Record<
      string,
      { state: string; activity?: string; size?: number; received?: number; derived?: boolean }
    >;
  };
}

export type SidecarStatus = (
  { state: "idle" | "starting" | "ready" | "missing" } | { state: "failed"; error: string }
) & { health: SidecarHealth | null };

export interface DesktopBridge {
  /** True on the bundled page. */
  readonly home: boolean;
  /** The device: "linux", "macos", "windows", "android" (absent in older builds: a computer). */
  readonly os?: string;
  info(): Promise<{
    version: string;
    /** The bundled language server's address (`vuurtoren-nlp:` protocol); null on a phone. */
    nlpBase?: string | null;
  }>;
  /**
   * What to do before the window closes (the last sync): the app waits for it, at most a few
   * seconds, then closes. Returns a function that removes it.
   */
  beforeClose?(fn: () => Promise<void>): () => void;
  /** One AnkiConnect request, sent by the app (no browser Origin, so no CORS setup). */
  ankiFetch(req: {
    url: string;
    method: string;
    body?: string | undefined;
  }): Promise<{ status: number; body: string }>;
  /** The local database file. */
  db: NativeDb & {
    open(force?: boolean): Promise<DbOpened>;
    /** Show the file in the system file manager. */
    reveal(): Promise<void>;
    /** Pick a folder, copy the database there and switch to it; null when cancelled. */
    move(): Promise<string | null>;
  };
  /** The bundled language server. */
  nlp: {
    status(): Promise<SidecarStatus>;
    restart(): Promise<void>;
    retryPacks(): Promise<void>;
  };
  /**
   * Sync: a folder you already sync (Syncthing, Dropbox, iCloud Drive), and requests to sync
   * places the page cannot reach itself (no CORS for the app).
   */
  sync?: DesktopSync;
  /** `vuurtoren://` links that opened the app (phones); taken once. */
  links?: {
    take(): Promise<string[]>;
    /** Called when a new link arrived; returns its removal. */
    onArrive(fn: () => void): () => void;
  };
  /** A QR code read with the camera (phones): its text, or null when cancelled or not allowed. */
  scanQr?: () => Promise<string | null>;
  /** Stop a running scan (its promise then gives null). */
  cancelScan?: () => Promise<void>;
  /** The dictionary pack on the device (phones): meanings without a server. */
  dictionary?: DeviceDictionary;
  /** The recordings pack on the device (phones): recorded words and sentences without a server. */
  audio?: DeviceAudio;
  /**
   * Android Back (button or gesture): while the page listens, every Back comes to it (with
   * whether the WebView has a page to go back to) and nothing happens on its own; `exit` leaves.
   */
  back?: {
    listen(fn: (e: { canGoBack: boolean }) => void): () => void;
    exit(): Promise<void>;
  };
}

/** The `audio-nl` pack kept on the device (`audio.rs`). */
export interface DeviceAudio {
  status(): Promise<{
    installed: boolean;
    bytes: number;
    download: number;
    downloading?: boolean;
    received?: number;
  }>;
  /** A clip's mp3 bytes; empty when the pack is not there or has no such clip. */
  clip(voice: string, id: string): Promise<ArrayBuffer>;
  /** Download and unpack it (the connected server first, else the data host). */
  install(from?: { nlp: string; token: string } | null): Promise<"server" | "release">;
  /** Remove it from the device. */
  remove(): Promise<void>;
}

/** One dictionary entry, as the language server's `/gloss` gives it. */
interface GlossEntry {
  pos: string;
  article: string | null;
  glosses: string[];
}

/** The `dictionary-nl` pack kept on the device (`dictionary.rs`). */
interface DeviceDictionary {
  /**
   * Is it there, its size, the size of its download, whether it is downloading and the bytes
   * on disk so far (also those of a download that stopped; the next one goes on from there).
   */
  status(): Promise<{
    installed: boolean;
    bytes: number;
    download: number;
    downloading?: boolean;
    received?: number;
  }>;
  /** Entries per word; null when the pack is not on the device. */
  gloss(words: string[]): Promise<Record<string, GlossEntry[]> | null>;
  /** Everything the word card shows about one word; null when the pack is not on the device. */
  entry?(word: string, pos?: string): Promise<EntryResult | null>;
  /**
   * Download it, checked against packs.json, and put it in place: from the connected server
   * (`from`: its language server and the device's sync token) when it has a copy, else from the
   * data host (data.vuurtoren.app). Says where it came from.
   */
  install(from?: { nlp: string; token: string } | null): Promise<"server" | "release">;
}

/** The secrets the device's key store keeps for the page. */
export type SecretName = "sync-key" | "sync-token";

/** What the desktop app offers for sync (see `apps/web/src/sync/desktopStore.ts`). */
export interface DesktopSync {
  /** The system folder dialog; the chosen folder becomes a sync root. Null when cancelled. */
  pickFolder(): Promise<string | null>;
  /** Names directly inside `dir` of a chosen folder (empty when it does not exist). */
  list(root: string, dir: string): Promise<string[]>;
  get(root: string, path: string): Promise<Uint8Array | null>;
  /** Written whole (a temporary file, then renamed), creating folders as needed. */
  put(root: string, path: string, bytes: Uint8Array): Promise<void>;
  remove(root: string, path: string): Promise<void>;
  /**
   * Allow `fetch` to reach the address (scheme, host and port) of `url`. The first time, the
   * app asks the user in its own dialog; rejects when they decline. Optional: older builds and
   * test fakes have no list of allowed addresses.
   */
  allowHost?(url: string): Promise<void>;
  /**
   * A secret in the device's key store: the sync key (base64; `name` absent) or a server's sync
   * token (`name` "sync-token"). The system keychain, or a file only this user can read when the
   * system has none, or the Android Keystore; resolves with where it went. Use
   * `../sync/keyStore.ts` rather than these.
   */
  saveKey?(key: string, name?: SecretName): Promise<"keychain" | "file" | "keystore">;
  loadKey?(name?: SecretName): Promise<string | null>;
  forgetKey?(name?: SecretName): Promise<void>;
  /**
   * An HTTP request sent by the app (http/https, the methods a sync place needs), only to an
   * allowed address; redirects to another address come back as they are, and no cookies.
   */
  fetch(req: {
    url: string;
    method: string;
    headers?: Record<string, string>;
    body?: Uint8Array;
  }): Promise<{ status: number; headers: Record<string, string>; body: Uint8Array }>;
}

declare global {
  interface Window {
    __VUURTOREN_DESKTOP__?: DesktopBridge;
  }
}

/** The desktop bridge, or null in a normal browser. */
export function desktopBridge(): DesktopBridge | null {
  return (typeof window !== "undefined" && window.__VUURTOREN_DESKTOP__) || null;
}

/** AnkiConnect on this machine: the only address the desktop bridge forwards. */
export function isLocalAnki(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === "http:" &&
      u.port === "8765" &&
      (u.hostname === "127.0.0.1" || u.hostname === "localhost")
    );
  } catch {
    return false;
  }
}

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

/** Settle with `p`, or reject with the signal's reason as soon as it aborts. */
function abortable<T>(p: Promise<T>, signal: AbortSignal | null | undefined): Promise<T> {
  if (!signal) return p;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason as Error);
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * A fetch that sends AnkiConnect requests through the desktop bridge and everything else to
 * `fallback`. Bridge failures surface as a `TypeError`, like a failed browser fetch, so the
 * Anki client reports "not running" exactly as in the browser.
 */
export function withDesktopAnki(bridge: DesktopBridge, fallback: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = urlOf(input);
    if (!isLocalAnki(url)) return fallback(input, init);
    const signal = init?.signal;
    signal?.throwIfAborted();
    const body = typeof init?.body === "string" ? init.body : undefined;
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    let res: { status: number; body: string };
    try {
      res = await abortable(bridge.ankiFetch({ url, method, body }), signal);
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new TypeError(typeof e === "string" ? e : "cannot reach AnkiConnect", { cause: e });
    }
    const empty = res.status === 204 || res.status === 304;
    return new Response(empty ? null : res.body, { status: res.status });
  };
}

/**
 * Send the app's `/nlp/...` requests (the default language-server address) to the
 * bundled language server's protocol. Installed once at boot; everything else is untouched.
 */
export function routeNlpTo(base: string, fallback: typeof fetch): typeof fetch {
  const target = base.replace(/\/+$/, "");
  const rewrite = (url: string): string | null => {
    let u: URL;
    try {
      u = new URL(url, location.href);
    } catch {
      return null;
    }
    const same = u.protocol === location.protocol && u.host === location.host;
    if (!same || !(u.pathname === "/nlp" || u.pathname.startsWith("/nlp/"))) return null;
    return `${target}${u.pathname.slice(4) || "/"}${u.search}`;
  };
  return (input, init) => {
    const to = rewrite(urlOf(input));
    if (!to) return fallback(input, init);
    return fallback(input instanceof Request ? new Request(to, input) : to, init);
  };
}
