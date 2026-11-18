/**
 * The desktop app (apps/desktop, Tauri) injects `window.__KENNING_DESKTOP__` into every page
 * its window loads: the bundled home page (the offline app, or the Connect screen) and the
 * user's Kenning server. In a normal browser it is absent and nothing here changes behaviour.
 * See docs/desktop.md.
 */
import type { NativeDb } from "@app/db/native";

/** `/api/health` as the Connect screen needs it (a subset of `ServerHealth`). */
interface DesktopHealth {
  schemaVersion: number;
  authRequired?: boolean;
}

/** Who has the database file open (the lock file next to it, `db.rs`). */
export interface DbLock {
  host: string;
  pid: number;
  /** Unix seconds: opened, and last sign of life (refreshed every minute). */
  since: number;
  seen: number;
}

export interface DbOpened {
  /** The database file (`~/Documents/Kenning/kenning.sqlite` by default). */
  path: string;
  /** True on the very first start (the file was just created). */
  created: boolean;
  /** Sync-tool conflict copies next to the file. */
  conflicts: string[];
  /** Another computer has the file open; nothing was opened. */
  locked: DbLock | null;
}

/** The bundled language server's `/health`, as far as the app uses it. */
export interface SidecarHealth {
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
  /** True on the bundled home page; false on the user's server. */
  readonly home: boolean;
  info(): Promise<{
    version: string;
    serverUrl: string | null;
    /** "local": this computer only (the default); "server": open `serverUrl`. */
    mode?: "local" | "server";
    /** The bundled language server's address (`kenning-nlp:` protocol). */
    nlpBase?: string;
  }>;
  /** GET `<url>/api/health` from the app (home page only). Rejects with a readable message. */
  checkServer(url: string): Promise<{ url: string; health: DesktopHealth }>;
  /** Remember the server and open it in the window (home page only). */
  connect(url: string): Promise<void>;
  /** Back to the Connect screen. */
  changeServer(): Promise<void>;
  /** One AnkiConnect request, sent by the app (no browser Origin, so no CORS setup). */
  ankiFetch(req: {
    url: string;
    method: string;
    body?: string | undefined;
  }): Promise<{ status: number; body: string }>;
  /** Use Kenning on this computer only (home page; reloads it in offline mode). */
  useLocal(): Promise<void>;
  /** The local database file (offline mode, home page only). */
  db: NativeDb & {
    open(force?: boolean): Promise<DbOpened>;
    /** Show the file in the system file manager. */
    reveal(): Promise<void>;
    /** Pick a folder, copy the database there and switch to it; null when cancelled. */
    move(): Promise<string | null>;
  };
  /** The bundled language server (offline mode, home page only). */
  nlp: {
    status(): Promise<SidecarStatus>;
    restart(): Promise<void>;
    retryPacks(): Promise<void>;
  };
}

declare global {
  interface Window {
    __KENNING_DESKTOP__?: DesktopBridge;
  }
}

/** The desktop bridge, or null in a normal browser. */
export function desktopBridge(): DesktopBridge | null {
  return (typeof window !== "undefined" && window.__KENNING_DESKTOP__) || null;
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
 * Offline mode: send the app's `/nlp/...` requests (the default language-server address) to the
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
