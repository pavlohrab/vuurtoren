/**
 * Sync through WebDAV (Nextcloud, ownCloud, a NAS, Fastmail Files…): PROPFIND to list,
 * GET/PUT/DELETE for files, MKCOL for folders. An app password is better than the account's.
 */
import { type SyncStore, toBase64 } from "@app/db";
import { SyncPlaceError, readError } from "./errors.js";
import { placeLabel } from "./labels.js";

/** File and folder names of a PROPFIND (Depth 1) answer, without the folder itself. */
export function propfindNames(xml: string, dirUrl: string): string[] {
  const self = new URL(dirUrl).pathname.replace(/\/+$/, "");
  const names = new Set<string>();
  for (const m of xml.matchAll(/<(?:[\w-]+:)?href>([^<]+)<\/(?:[\w-]+:)?href>/gi)) {
    let path: string;
    try {
      path = decodeURIComponent(new URL(m[1]!.trim(), dirUrl).pathname).replace(/\/+$/, "");
    } catch {
      continue;
    }
    if (path === decodeURIComponent(self)) continue;
    const name = path.split("/").pop();
    if (name) names.add(name);
  }
  return [...names].sort();
}

export function webdavStore(
  url: string,
  user: string,
  password: string,
  fetch: typeof globalThis.fetch,
): SyncStore {
  const root = url.replace(/\/+$/, "");
  const auth = {
    authorization: `Basic ${toBase64(new TextEncoder().encode(`${user}:${password}`))}`,
  };
  const at = (path: string) =>
    `${root}/${path.split("/").filter(Boolean).map(encodeURIComponent).join("/")}`;
  const call = async (target: string, init: RequestInit) => {
    let res: Response;
    try {
      res = await fetch(target, {
        ...init,
        cache: "no-store",
        headers: { ...auth, ...init.headers },
      });
    } catch {
      throw new SyncPlaceError(`${new URL(root).host} cannot be reached.`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new SyncPlaceError("The WebDAV server did not accept the user name or password.");
    }
    return res;
  };
  /** Make every folder of `path` that is missing (MKCOL answers 405 when it exists). */
  const folders = async (path: string) => {
    const parts = path.split("/").filter(Boolean).slice(0, -1);
    for (let i = 1; i <= parts.length; i++) {
      const res = await call(`${at(parts.slice(0, i).join("/"))}/`, { method: "MKCOL" });
      if (!res.ok && res.status !== 405 && res.status !== 301) throw await readError(res);
    }
  };
  return {
    label: placeLabel({ kind: "webdav", url: root }),
    async list(dir) {
      const target = `${dir ? at(dir) : root}/`;
      const res = await call(target, {
        method: "PROPFIND",
        headers: { depth: "1", "content-type": "application/xml" },
        body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',
      });
      if (res.status === 404) return [];
      if (!res.ok) throw await readError(res);
      return propfindNames(await res.text(), target);
    },
    async get(path) {
      const res = await call(at(path), { method: "GET" });
      if (res.status === 404) return null;
      if (!res.ok) throw await readError(res);
      return new Uint8Array(await res.arrayBuffer());
    },
    async put(path, bytes) {
      const send = () =>
        call(at(path), {
          method: "PUT",
          headers: { "content-type": "application/octet-stream" },
          body: bytes as BodyInit,
        });
      let res = await send();
      if (res.status === 409 || res.status === 404) {
        await folders(path);
        res = await send();
      }
      if (!res.ok) throw await readError(res);
    },
    async remove(path) {
      const res = await call(at(path), { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw await readError(res);
    },
  };
}
