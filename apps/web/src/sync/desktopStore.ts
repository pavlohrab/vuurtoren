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

/** Request headers as a plain object (whatever form `init.headers` takes). */
function headersOf(
  init: RequestInit | undefined,
  input: RequestInfo | URL,
): Record<string, string> {
  const h = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((v, k) => h.set(k, v));
  return Object.fromEntries(h.entries());
}

async function bodyOf(init: RequestInit | undefined): Promise<Uint8Array | undefined> {
  const body = init?.body;
  if (body === undefined || body === null) return undefined;
  return new Uint8Array(await new Response(body).arrayBuffer());
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
export function desktopFetch(sync: DesktopSync): typeof fetch {
  return async (input, init) => {
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    let res: Awaited<ReturnType<DesktopSync["fetch"]>>;
    try {
      await allowHost(sync, urlOf(input));
      const body = await bodyOf(init);
      res = await sync.fetch({
        url: urlOf(input),
        method,
        headers: headersOf(init, input),
        ...(body ? { body } : {}),
      });
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
