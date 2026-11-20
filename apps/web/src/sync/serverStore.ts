/** Sync through a Kenning server's `/api/sync`, with a sync token made on that server. */
import type { SyncStore } from "@app/db";
import { SyncPlaceError, readError } from "./errors.js";
import { placeLabel } from "./labels.js";

export function serverStore(url: string, token: string, fetch: typeof globalThis.fetch): SyncStore {
  const base = url.replace(/\/+$/, "");
  // X-Kenning: a server with sign-in off has no token to check, and asks for it on writes.
  const auth = { authorization: `Bearer ${token}`, "x-kenning": "1" };
  const call = async (path: string, init: RequestInit = {}) => {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        ...init,
        cache: "no-store",
        headers: { ...auth, ...init.headers },
      });
    } catch {
      throw new SyncPlaceError(`Kenning at ${new URL(base).host} cannot be reached.`, "offline");
    }
    if (res.status === 401) {
      throw new SyncPlaceError("The server did not accept the sync token.", "auth");
    }
    return res;
  };
  const file = (path: string) => `/api/sync/file?path=${encodeURIComponent(path)}`;
  return {
    label: placeLabel({ kind: "server", url: base }),
    async list(dir) {
      const res = await call(`/api/sync/list?dir=${encodeURIComponent(dir)}`);
      if (!res.ok) throw await readError(res);
      return ((await res.json()) as { names: string[] }).names;
    },
    async get(path) {
      const res = await call(file(path));
      if (res.status === 404) return null;
      if (!res.ok) throw await readError(res);
      return new Uint8Array(await res.arrayBuffer());
    },
    async put(path, bytes) {
      const res = await call(file(path), {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: bytes as BodyInit,
      });
      if (!res.ok) throw await readError(res);
    },
    async remove(path) {
      const res = await call(file(path), { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw await readError(res);
    },
  };
}
