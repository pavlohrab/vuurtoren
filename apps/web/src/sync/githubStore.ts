/**
 * Sync through a private GitHub repository (the contents API), with a fine-grained token that
 * may read and write that one repository's contents. Every write is a small commit.
 */
import type { SyncStore } from "@app/db";
import { base64 } from "./base64.js";
import { SyncPlaceError, readError } from "./errors.js";

const API = "https://api.github.com";
/** Entries the contents API lists at most for one folder. */
const CONTENTS_LIMIT = 1000;

export function githubStore(
  repo: string,
  token: string,
  fetch: typeof globalThis.fetch,
  branch?: string,
): SyncStore {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    throw new SyncPlaceError("Write the repository as owner/name.");
  }
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
  const ref = branch ? `?ref=${encodeURIComponent(branch)}` : "";
  const contents = (path: string) =>
    `${API}/repos/${repo}/contents/${path.split("/").filter(Boolean).map(encodeURIComponent).join("/")}`;
  /** The blob sha of each file seen, needed to replace or remove it. */
  const shas = new Map<string, string>();

  const call = async (url: string, init: RequestInit = {}) => {
    let res: Response;
    try {
      // GitHub answers with max-age=60: a cached listing would hold an old sha.
      res = await fetch(url, {
        ...init,
        cache: "no-store",
        headers: { ...headers, ...init.headers },
      });
    } catch {
      throw new SyncPlaceError("GitHub cannot be reached.", "offline");
    }
    if (res.status === 401) throw new SyncPlaceError("GitHub did not accept the token.", "auth");
    if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
      throw new SyncPlaceError("GitHub asks to wait a while (rate limit).", "offline");
    }
    return res;
  };

  /** The sha of a file in the repository, or undefined when there is none. */
  const shaOf = async (path: string): Promise<string | undefined> => {
    const res = await call(`${contents(path)}${ref}`);
    if (res.status === 404) return undefined;
    if (!res.ok) throw await readError(res);
    const sha = ((await res.json()) as { sha?: string }).sha;
    if (sha) shas.set(path, sha);
    return sha;
  };

  /** Every entry of a folder through the Git trees API, or null when it cannot be read. */
  const treeOf = async (
    dir: string,
  ): Promise<{ name: string; sha: string; type: string }[] | null> => {
    const parts = dir.split("/").filter(Boolean);
    const leaf = parts.pop();
    if (!leaf) return null;
    const res = await call(`${contents(parts.join("/"))}${ref}`);
    if (!res.ok) return null;
    const parent = (await res.json()) as { name: string; sha: string; type: string }[];
    const sha = Array.isArray(parent)
      ? parent.find((it) => it.name === leaf && it.type === "dir")?.sha
      : undefined;
    if (!sha) return null;
    const tree = await call(`${API}/repos/${repo}/git/trees/${sha}`);
    if (!tree.ok) return null;
    const body = (await tree.json()) as { tree?: { path: string; sha: string; type: string }[] };
    if (!Array.isArray(body.tree)) return null;
    return body.tree.map((t) => ({
      name: t.path,
      sha: t.sha,
      type: t.type === "blob" ? "file" : "dir",
    }));
  };

  return {
    label: `GitHub · ${repo}`,
    async list(dir) {
      const res = await call(`${contents(dir)}${ref}`);
      if (res.status === 404) return [];
      if (!res.ok) throw await readError(res);
      let items = (await res.json()) as { name: string; sha: string; type: string }[];
      if (!Array.isArray(items)) return [];
      // The contents API stops at 1000 entries; the folder's git tree holds them all.
      if (items.length >= CONTENTS_LIMIT) items = (await treeOf(dir)) ?? items;
      for (const it of items)
        if (it.type === "file") shas.set(`${dir}/${it.name}`.replace(/^\//, ""), it.sha);
      return items.map((it) => it.name).sort();
    },
    async get(path) {
      const res = await call(`${contents(path)}${ref}`, {
        headers: { accept: "application/vnd.github.raw+json" },
      });
      if (res.status === 404) return null;
      if (!res.ok) throw await readError(res);
      return new Uint8Array(await res.arrayBuffer());
    },
    async put(path, bytes) {
      const send = async (sha: string | undefined) =>
        call(contents(path), {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            message: `Kenning sync: ${path.split("/").pop()}`,
            content: base64(bytes),
            ...(sha ? { sha } : {}),
            ...(branch ? { branch } : {}),
          }),
        });
      let res = await send(shas.get(path) ?? (await shaOf(path)));
      // Changed since it was listed: take the current sha once more.
      if (res.status === 409 || res.status === 422) res = await send(await shaOf(path));
      if (!res.ok) throw await readError(res);
      const sha = ((await res.json()) as { content?: { sha?: string } }).content?.sha;
      if (sha) shas.set(path, sha);
    },
    async remove(path) {
      const sha = shas.get(path) ?? (await shaOf(path));
      if (!sha) return;
      const res = await call(contents(path), {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: "Kenning sync: tidy up",
          sha,
          ...(branch ? { branch } : {}),
        }),
      });
      if (!res.ok && res.status !== 404) throw await readError(res);
      shas.delete(path);
    },
  };
}
