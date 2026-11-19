/**
 * The three places behind fake servers: the same behaviour from each, and two devices syncing
 * through each with the real engine.
 */
import { describe, expect, it } from "vitest";
import { type SyncStore, createRepository, openVault, syncOnce } from "@app/db";
import { createNodeDriver } from "@app/db/node";
import { githubStore } from "./githubStore.js";
import { propfindNames, webdavStore } from "./webdavStore.js";
import { serverStore } from "./serverStore.js";

type Files = Map<string, Uint8Array>;
const bytesOf = async (body: BodyInit | null | undefined) =>
  body ? new Uint8Array(await new Response(body).arrayBuffer()) : new Uint8Array();
const names = (files: Files, dir: string) => {
  const prefix = dir ? `${dir}/` : "";
  const out = new Set<string>();
  for (const p of files.keys())
    if (p.startsWith(prefix)) out.add(p.slice(prefix.length).split("/")[0]!);
  return [...out].sort();
};

/** /api/sync of a Kenning server. */
function fakeServer(files: Files, token: string): typeof fetch {
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (new Headers(init.headers).get("authorization") !== `Bearer ${token}`) {
      return new Response("{}", { status: 401 });
    }
    const path = url.searchParams.get("path") ?? "";
    if (url.pathname === "/api/sync/list") {
      return Response.json({ ok: true, names: names(files, url.searchParams.get("dir") ?? "") });
    }
    const method = init.method ?? "GET";
    if (method === "GET") {
      const b = files.get(path);
      return b ? new Response(b as BodyInit) : new Response("{}", { status: 404 });
    }
    if (method === "PUT") files.set(path, await bytesOf(init.body));
    if (method === "DELETE") files.delete(path);
    return Response.json({ ok: true });
  }) as typeof fetch;
}

/** A WebDAV server at https://dav.example/files/anna (folders must exist before PUT). */
function fakeDav(files: Files, dirs: Set<string>): typeof fetch {
  const ROOT = "/files/anna";
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (!new Headers(init.headers).get("authorization")?.startsWith("Basic ")) {
      return new Response("", { status: 401 });
    }
    const rel = decodeURIComponent(url.pathname.slice(ROOT.length)).replace(/^\/|\/$/g, "");
    switch (init.method) {
      case "PROPFIND": {
        if (rel && !dirs.has(rel)) return new Response("", { status: 404 });
        const hrefs = [rel, ...names(files, rel).map((n) => (rel ? `${rel}/${n}` : n))]
          .map(
            (p) =>
              `<D:response><D:href>${ROOT}/${p.split("/").map(encodeURIComponent).join("/")}</D:href></D:response>`,
          )
          .join("");
        return new Response(
          `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">${hrefs}</D:multistatus>`,
          { status: 207 },
        );
      }
      case "MKCOL":
        if (dirs.has(rel)) return new Response("", { status: 405 });
        dirs.add(rel);
        return new Response("", { status: 201 });
      case "PUT": {
        const parent = rel.split("/").slice(0, -1).join("/");
        if (parent && !dirs.has(parent)) return new Response("", { status: 409 });
        files.set(rel, await bytesOf(init.body));
        return new Response("", { status: 201 });
      }
      case "DELETE":
        files.delete(rel);
        return new Response(null, { status: 204 });
      default: {
        const b = files.get(rel);
        return b ? new Response(b as BodyInit) : new Response("", { status: 404 });
      }
    }
  }) as typeof fetch;
}

/** GitHub's contents API for one repository. */
function fakeGithub(files: Files): typeof fetch {
  const shas = new Map<string, string>();
  let n = 0;
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const m = /^\/repos\/anna\/kenning-sync\/contents\/?(.*)$/.exec(url.pathname);
    if (!m) return new Response("{}", { status: 404 });
    const path = decodeURIComponent(m[1]!);
    const headers = new Headers(init.headers);
    if (headers.get("authorization") !== "Bearer ghp_x") return new Response("{}", { status: 401 });
    const method = init.method ?? "GET";
    if (method === "GET") {
      const file = files.get(path);
      if (file) {
        if (headers.get("accept") === "application/vnd.github.raw+json")
          return new Response(file as BodyInit);
        return Response.json({ sha: shas.get(path), name: path.split("/").pop(), type: "file" });
      }
      const list = names(files, path);
      if (!list.length) return Response.json({ message: "Not Found" }, { status: 404 });
      return Response.json(
        list.map((name) => {
          const p = path ? `${path}/${name}` : name;
          return { name, type: files.has(p) ? "file" : "dir", sha: shas.get(p) ?? "" };
        }),
      );
    }
    const body = JSON.parse(String(init.body)) as { content?: string; sha?: string };
    if ((files.has(path) ? shas.get(path) : undefined) !== body.sha) {
      return Response.json({ message: "sha does not match" }, { status: 409 });
    }
    if (method === "DELETE") {
      files.delete(path);
      shas.delete(path);
      return Response.json({});
    }
    files.set(
      path,
      Uint8Array.from(atob(body.content!), (c) => c.charCodeAt(0)),
    );
    shas.set(path, `sha${++n}`);
    return Response.json({ content: { sha: shas.get(path) } });
  }) as typeof fetch;
}

const places: [string, () => SyncStore][] = [
  [
    "Kenning server",
    () => serverStore("https://kenning.example/", "ksync_t", fakeServer(new Map(), "ksync_t")),
  ],
  [
    "WebDAV",
    () =>
      webdavStore(
        "https://dav.example/files/anna",
        "anna",
        "app-password",
        fakeDav(new Map(), new Set()),
      ),
  ],
  ["GitHub", () => githubStore("anna/kenning-sync", "ghp_x", fakeGithub(new Map()))],
];

describe.each(places)("%s", (_name, make) => {
  it("lists, reads, writes, replaces and removes files", async () => {
    const store = make();
    expect(await store.list("kenning/devices")).toEqual([]);
    expect(await store.get("kenning/vault.json")).toBeNull();
    await store.put("kenning/devices/abc/1.kev", new Uint8Array([1, 2]));
    await store.put("kenning/devices/abc/1.kev", new Uint8Array([3]));
    await store.put("kenning/devices/def/2.kev", new Uint8Array([4]));
    expect(await store.list("kenning/devices")).toEqual(["abc", "def"]);
    expect(await store.list("kenning/devices/abc")).toEqual(["1.kev"]);
    expect(await store.get("kenning/devices/abc/1.kev")).toEqual(new Uint8Array([3]));
    await store.remove("kenning/devices/abc/1.kev");
    await store.remove("kenning/devices/abc/1.kev");
    expect(await store.get("kenning/devices/abc/1.kev")).toBeNull();
  });

  it("carries two devices' changes with the sync engine", async () => {
    const store = make();
    const a = await createRepository(await createNodeDriver(), { deviceId: "aaaaaaaaaaaa" });
    const b = await createRepository(await createNodeDriver(), { deviceId: "bbbbbbbbbbbb" });
    const key = await openVault(store, "lange zinnen lezen", true, 1000);
    await a.append({ type: "WordStateSet", lang: "nl", key: "fiets", state: "known" });
    await syncOnce(a, store, key, { deviceName: "Laptop" });
    expect(await syncOnce(b, store, key, { deviceName: "Phone" })).toMatchObject({ received: 1 });
    expect((await b.word("nl", "fiets"))?.state).toBe("known");
  });
});

describe("credentials refused", () => {
  it("says so in plain words", async () => {
    const wrong = serverStore("https://kenning.example", "nope", fakeServer(new Map(), "ksync_t"));
    await expect(wrong.list("")).rejects.toMatchObject({ kind: "auth" });
    const offline = webdavStore("https://dav.example/x", "a", "b", (async () => {
      throw new TypeError("network");
    }) as typeof fetch);
    await expect(offline.get("a")).rejects.toMatchObject({ kind: "offline" });
    expect(() => githubStore("not a repo", "t", fetch)).toThrow(/owner\/name/);
  });

  it("reads Nextcloud's PROPFIND answer", () => {
    const xml = `<d:multistatus xmlns:d="DAV:"><d:response><d:href>/remote.php/dav/files/anna/Kenning/</d:href></d:response><d:response><d:href>/remote.php/dav/files/anna/Kenning/kenning/</d:href></d:response><d:response><d:href>/remote.php/dav/files/anna/Kenning/vault%20file.json</d:href></d:response></d:multistatus>`;
    expect(propfindNames(xml, "https://cloud.example/remote.php/dav/files/anna/Kenning/")).toEqual([
      "kenning",
      "vault file.json",
    ]);
  });
});
