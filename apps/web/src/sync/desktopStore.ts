/**
 * Sync places through the desktop app: a folder you already sync (Syncthing, Dropbox, iCloud
 * Drive), and a fetch sent by the app for places the page cannot reach because of CORS.
 */
import type { SyncStore } from "@app/db";
import type { DesktopSync } from "../desktop/bridge.js";
import { placeLabel } from "./labels.js";

/** A synced folder on this computer as a sync place. */
export function folderStore(sync: DesktopSync, root: string): SyncStore {
  return {
    label: placeLabel({ kind: "folder", path: root }),
    list: (dir) => sync.list(root, dir),
    get: (path) => sync.get(root, path),
    put: (path, bytes) => sync.put(root, path, bytes),
    remove: (path) => sync.remove(root, path),
  };
}

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

interface WireRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Uint8Array;
}

/**
 * The request as the app sends it: method, headers and body bytes. It goes through one `Request`
 * built from the caller's input and init, so the headers a body makes for itself (a FormData's
 * `multipart/form-data; boundary=…`, a Blob's type, URLSearchParams) travel with its bytes.
 */
async function wireRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): Promise<WireRequest> {
  const url = urlOf(input);
  // The app's request cannot be cancelled, so the signal stays with the caller.
  const req = new Request(input instanceof Request ? input : url, { ...init, signal: null });
  const method = req.method.toUpperCase();
  const headers = Object.fromEntries(req.headers.entries());
  if (req.body === null) return { url, method, headers };
  return { url, method, headers, body: new Uint8Array(await req.arrayBuffer()) };
}

/** Addresses the app already allowed in this session, per bridge (one question per address). */
const allowed = new WeakMap<DesktopSync, Map<string, Promise<void>>>();

/**
 * Ask the app to allow requests to the address of `url` (it asks the user the first time).
 * A refusal is not remembered here, so the next sync gets the app's own answer again.
 */
function allowHost(sync: DesktopSync, url: string): Promise<void> {
  if (!sync.allowHost) return Promise.resolve();
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    // Not an address: the app refuses the request itself with a readable message.
    return Promise.resolve();
  }
  const known = allowed.get(sync) ?? new Map<string, Promise<void>>();
  allowed.set(sync, known);
  const asked = known.get(origin);
  if (asked) return asked;
  const p = sync.allowHost(url);
  known.set(origin, p);
  p.catch(() => known.delete(origin));
  return p;
}

/**
 * A `fetch` sent by the desktop app, only to addresses the user allowed. Failures of the bridge
 * (no network, a refused address) surface as a `TypeError`, like a failed browser fetch.
 */
export function desktopFetch(sync: DesktopSync, pinned?: string): typeof fetch {
  return async (input, init) => {
    let method: string;
    let res: Awaited<ReturnType<DesktopSync["fetch"]>>;
    try {
      await allowHost(sync, urlOf(input));
      const req = await wireRequest(input, init);
      method = req.method;
      // "Connect a phone": only the computer's certificate from the QR code is trusted.
      res = await sync.fetch(pinned ? { ...req, pinned } : req);
    } catch (e) {
      throw new TypeError(e instanceof Error ? e.message : String(e), { cause: e });
    }
    // A Response cannot carry a body for these statuses.
    const empty = method === "HEAD" || [101, 204, 205, 304].includes(res.status);
    return new Response(empty ? null : (res.body as BodyInit), {
      status: res.status,
      headers: res.headers,
    });
  };
}
