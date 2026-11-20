/** Fake sync places for tests: a Vuurtoren server's /api/sync, a WebDAV server, GitHub. */
export type Files = Map<string, Uint8Array>;
const bytesOf = async (body: BodyInit | null | undefined) =>
  body ? new Uint8Array(await new Response(body).arrayBuffer()) : new Uint8Array();
const names = (files: Files, dir: string) => {
  const prefix = dir ? `${dir}/` : "";
  const out = new Set<string>();
  for (const p of files.keys())
    if (p.startsWith(prefix)) out.add(p.slice(prefix.length).split("/")[0]!);
  return [...out].sort();
};

/** /api/sync of a Vuurtoren server. */
export function fakeServer(files: Files, token: string): typeof fetch {
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
export function fakeDav(files: Files, dirs: Set<string>): typeof fetch {
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
export function fakeGithub(files: Files): typeof fetch {
  const shas = new Map<string, string>();
  let n = 0;
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const headers = new Headers(init.headers);
    if (headers.get("authorization") !== "Bearer ghp_x") return new Response("{}", { status: 401 });
    // A folder's git tree (its sha here is "tree:<path>"): every entry.
    const tree = /^\/repos\/anna\/vuurtoren-sync\/git\/trees\/tree:(.+)$/.exec(url.pathname);
    if (tree) {
      const dir = decodeURIComponent(tree[1]!);
      return Response.json({
        tree: names(files, dir).map((name) => {
          const p = `${dir}/${name}`;
          return { path: name, type: files.has(p) ? "blob" : "tree", sha: shas.get(p) ?? "" };
        }),
      });
    }
    const m = /^\/repos\/anna\/vuurtoren-sync\/contents\/?(.*)$/.exec(url.pathname);
    if (!m) return new Response("{}", { status: 404 });
    const path = decodeURIComponent(m[1]!);
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
      // Like GitHub, at most 1000 entries.
      return Response.json(
        list.slice(0, 1000).map((name) => {
          const p = path ? `${path}/${name}` : name;
          return files.has(p)
            ? { name, type: "file", sha: shas.get(p) ?? "" }
            : { name, type: "dir", sha: `tree:${p}` };
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
