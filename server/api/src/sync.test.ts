/** `/api/sync`: sealed files of devices, opened by a session or a sync token (and nothing else). */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAuth } from "./auth/index.js";
import { hashPassword, parsePasswordHash } from "./auth/password.js";
import { createApiServer } from "./server.js";
import { syncPath } from "./sync.js";
import { type SyncStore, createRepository, openVault, syncOnce } from "@app/db";
import { createNodeDriver } from "@app/db/node";
import { LIGHT_ARGON2 } from "@app/db/testing";

const PASSWORD = "correct horse battery";
let dir: string;
let server: ReturnType<typeof createApiServer>;
let auth: ReturnType<typeof createAuth>;
let base: string;
let hash: string;

interface Serve {
  /** Sign-in off. */
  open?: boolean;
  allowedOrigins?: string[];
  syncQuotaBytes?: number;
}

async function serve(opts: Serve = {}) {
  auth = createAuth({
    ...(opts.open ? {} : { user: "anna", password: parsePasswordHash(hash) }),
    sessionDb: join(dir, "auth.sqlite"),
    limiter: { freeFailures: 100 },
    ...(opts.allowedOrigins ? { allowedOrigins: opts.allowedOrigins } : {}),
  });
  server = createApiServer({
    auth,
    syncDir: join(dir, "sync"),
    syncQuotaBytes: opts.syncQuotaBytes,
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function stop() {
  await new Promise((r) => server.close(r));
  auth.close();
}

/** The same folders, another configuration. */
async function restart(opts: Serve) {
  await stop();
  await serve(opts);
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "vuurtoren-sync-"));
  hash ??= await hashPassword(PASSWORD, { N: 2 ** 10, r: 8, p: 1 });
  await serve();
});
afterEach(async () => {
  await stop();
  rmSync(dir, { recursive: true, force: true });
});

async function session(): Promise<string> {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ user: "anna", password: PASSWORD }),
  });
  return /vuurtoren_session=[^;]+/.exec(res.headers.get("set-cookie") ?? "")![0];
}

async function syncToken(cookie: string): Promise<{ token: string; id: string }> {
  const res = await fetch(`${base}/api/auth/sync-tokens`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ label: "Phone" }),
  });
  return (await res.json()) as { token: string; id: string };
}

const file = (path: string) => `${base}/api/sync/file?path=${encodeURIComponent(path)}`;

describe("/api/sync", () => {
  it("stores, lists, serves and removes files with a sync token", async () => {
    const cookie = await session();
    const { token, id } = await syncToken(cookie);
    expect(token).toMatch(/^ksync_[A-Za-z0-9_-]{43}$/);
    const bearer = { authorization: `Bearer ${token}` };
    const bytes = new Uint8Array([1, 2, 3, 4]);

    const put = await fetch(file("vuurtoren/devices/abc/01J.kev"), {
      method: "PUT",
      headers: bearer,
      body: bytes,
    });
    expect(put.status).toBe(200);
    const list = await fetch(`${base}/api/sync/list?dir=vuurtoren/devices`, { headers: bearer });
    expect(await list.json()).toEqual({ ok: true, names: ["abc"] });
    const got = await fetch(file("vuurtoren/devices/abc/01J.kev"), { headers: bearer });
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes);
    expect((await fetch(file("vuurtoren/vault.json"), { headers: bearer })).status).toBe(404);
    expect(
      (await fetch(file("vuurtoren/devices/abc/01J.kev"), { method: "DELETE", headers: bearer }))
        .status,
    ).toBe(200);
    expect(existsSync(join(dir, "sync", "vuurtoren", "devices", "abc", "01J.kev"))).toBe(false);

    // A sync token opens nothing else; a revoked one nothing at all.
    expect((await fetch(`${base}/api/auth/sync-tokens`, { headers: bearer })).status).toBe(401);
    expect((await fetch(`${base}/api/auth/me`, { headers: bearer })).status).toBe(401);
    const revoked = await fetch(`${base}/api/auth/sync-tokens/${id}`, {
      method: "DELETE",
      headers: { cookie, "x-vuurtoren": "1" },
    });
    expect(revoked.status).toBe(200);
    expect((await fetch(`${base}/api/sync/list?dir=`, { headers: bearer })).status).toBe(401);
  });

  it("works with a session on the same site, and refuses anyone else", async () => {
    const cookie = await session();
    const ok = await fetch(file("vuurtoren/vault.json"), {
      method: "PUT",
      headers: { cookie, "x-vuurtoren": "1" },
      body: new TextEncoder().encode("{}"),
    });
    expect(ok.status).toBe(200);
    expect((await fetch(`${base}/api/sync/list?dir=vuurtoren`)).status).toBe(401);
    expect(
      (
        await fetch(`${base}/api/sync/list?dir=vuurtoren`, {
          headers: { authorization: "Bearer ksync_madeupmadeupmadeupmadeupmadeupmadeupmadeu" },
        })
      ).status,
    ).toBe(401);
  });

  it("opens the language server (nginx's /nlp/ gate) for a session or a sync token", async () => {
    const cookie = await session();
    const { token } = await syncToken(cookie);
    const check = (uri: string, headers: Record<string, string>) =>
      fetch(`${base}/api/auth/check`, { headers: { "x-original-uri": uri, ...headers } }).then(
        (r) => r.status,
      );
    const bearer = { authorization: `Bearer ${token}` };
    expect(await check("/nlp/analyze/text", { cookie })).toBe(204);
    expect(await check("/nlp/analyze/text", bearer)).toBe(204);
    expect(await check("/nlp/course/ocr", bearer)).toBe(204);
    expect(await check("/api/sync/list?dir=", bearer)).toBe(204);
    expect(await check("/nlp/analyze/text", {})).toBe(401);
    expect(await check("/nlp/analyze/text", { authorization: "Bearer ksync_wrong" })).toBe(401);
    // A browser's preflight carries no token.
    expect(await check("/nlp/analyze/text", { "x-original-method": "OPTIONS" })).toBe(204);
    expect(await check("/api/sync/list?dir=", { "x-original-method": "OPTIONS" })).toBe(401);
    // Nothing else of the server.
    expect(await check("/api/auth/sync-tokens", bearer)).toBe(401);
    expect(await check("/nlpx", bearer)).toBe(401);
  });

  it("answers browsers elsewhere (CORS) and refuses paths outside its folder", async () => {
    const { token } = await syncToken(await session());
    const pre = await fetch(file("vuurtoren/vault.json"), {
      method: "OPTIONS",
      headers: { origin: "http://localhost:5173", "access-control-request-method": "PUT" },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(pre.headers.get("access-control-allow-headers")).toContain("authorization");
    const res = await fetch(`${base}/api/sync/list?dir=`, {
      headers: { authorization: `Bearer ${token}`, origin: "http://localhost:5173" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    for (const bad of ["../x", "a/../../b", "/etc/passwd", "a//b", "a/.", "a b"]) {
      const r = await fetch(file(bad), { headers: { authorization: `Bearer ${token}` } });
      expect(r.status, bad).toBe(400);
    }
    expect(() => syncPath("vuurtoren/devices/a1/01J.base.kev")).not.toThrow();
  });

  it("carries two devices' changes with the real sync engine", async () => {
    const cookie = await session();
    const store = placeFor((await syncToken(cookie)).token);
    const other = placeFor((await syncToken(cookie)).token);
    const a = await createRepository(await createNodeDriver(), { deviceId: "aaaaaaaaaaaa" });
    const b = await createRepository(await createNodeDriver(), { deviceId: "bbbbbbbbbbbb" });
    const key = (await openVault(store, "lange zinnen lezen", true, LIGHT_ARGON2)).key;
    await a.append({ type: "WordStateSet", lang: "nl", key: "fiets", state: "known" });
    expect(await syncOnce(a, store, key, { deviceName: "Laptop" })).toMatchObject({ sent: 1 });
    expect(await syncOnce(b, other, key, { deviceName: "Phone" })).toMatchObject({ received: 1 });
    expect((await b.word("nl", "fiets"))?.state).toBe("known");
    // One token, one device: the laptop's token cannot write as the phone.
    await b.append({ type: "WordStateSet", lang: "nl", key: "huis", state: "known" });
    await expect(syncOnce(b, store, key, { deviceName: "Phone" })).rejects.toThrow("HTTP 403");
  });
});

describe("/api/sync: what a sync token may write", () => {
  const put = (token: string, path: string, body = "x") =>
    fetch(file(path), {
      method: "PUT",
      headers: { authorization: `Bearer ${token}` },
      body,
    }).then((r) => r.status);
  const del = (token: string, path: string) =>
    fetch(file(path), { method: "DELETE", headers: { authorization: `Bearer ${token}` } }).then(
      (r) => r.status,
    );

  it("writes its own device folder and images, and nothing of another device", async () => {
    const cookie = await session();
    const { token, id } = await syncToken(cookie);
    // Not yet a device: removing anything in a device folder is refused.
    expect(await del(token, "vuurtoren/devices/aaa/01J.kev")).toBe(403);
    expect(await put(token, "vuurtoren/devices/aaa/01J.kev")).toBe(200);
    expect(await put(token, "vuurtoren/devices/aaa/device.kev")).toBe(200);
    expect(await del(token, "vuurtoren/devices/aaa/01J.kev")).toBe(200);
    expect(await put(token, "vuurtoren/devices/bbb/01J.kev")).toBe(403);
    expect(await del(token, "vuurtoren/devices/bbb/device.kev")).toBe(403);
    expect(await put(token, "vuurtoren/blobs/abc.kbl")).toBe(200);
    expect(await del(token, "vuurtoren/blobs/abc.kbl")).toBe(403);
    expect(await put(token, "elsewhere.txt")).toBe(403);
    expect(await put(token, "vuurtoren/devices")).toBe(403);
    // Settings shows which device a token belongs to.
    const list = (await (
      await fetch(`${base}/api/auth/sync-tokens`, { headers: { cookie } })
    ).json()) as { tokens: { id: string; device: string | null }[] };
    expect(list.tokens.find((t) => t.id === id)?.device).toBe("aaa");
  });

  it("creates vault.json when there is none; only its maker or a session replaces it", async () => {
    const cookie = await session();
    const first = (await syncToken(cookie)).token;
    const second = (await syncToken(cookie)).token;
    expect(await put(first, "vuurtoren/vault.json", "{1}")).toBe(200);
    expect(await put(second, "vuurtoren/vault.json", "{2}")).toBe(403);
    expect(await del(second, "vuurtoren/vault.json")).toBe(403);
    expect(await put(first, "vuurtoren/vault.json", "{3}")).toBe(200);
    const bySession = await fetch(file("vuurtoren/vault.json"), {
      method: "PUT",
      headers: { cookie, "x-vuurtoren": "1" },
      body: "{4}",
    });
    expect(bySession.status).toBe(200);
    // A token made for it may replace it too.
    const made = await fetch(`${base}/api/auth/sync-tokens`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ label: "Tablet", vault: true }),
    });
    const { token: allowed } = (await made.json()) as { token: string };
    expect(await put(allowed, "vuurtoren/vault.json", "{5}")).toBe(200);
    expect(readFileSync(join(dir, "sync", "vuurtoren", "vault.json"), "utf8")).toBe("{5}");
  });

  it("keeps all files within the quota, and leaves no half-written file", async () => {
    await restart({ syncQuotaBytes: 10 });
    const { token } = await syncToken(await session());
    expect(await put(token, "vuurtoren/devices/aaa/a.kev", "12345678")).toBe(200);
    const full = await fetch(file("vuurtoren/devices/aaa/b.kev"), {
      method: "PUT",
      headers: { authorization: `Bearer ${token}` },
      body: "12345678",
    });
    expect(full.status).toBe(507);
    expect(((await full.json()) as { error: string }).error).toMatch(/VUURTOREN_SYNC_QUOTA_MB/);
    // Replacing a file counts its new size only; removing one makes room.
    expect(await put(token, "vuurtoren/devices/aaa/a.kev", "1234567890")).toBe(200);
    expect(await del(token, "vuurtoren/devices/aaa/a.kev")).toBe(200);
    expect(await put(token, "vuurtoren/devices/aaa/b.kev", "12345678")).toBe(200);

    // A write that fails (a folder where the file should go) leaves no temporary file.
    await restart({});
    const cookie = await session();
    const failed = await fetch(file("vuurtoren/devices/aaa"), {
      method: "PUT",
      headers: { cookie, "x-vuurtoren": "1" },
      body: "x",
    });
    expect(failed.status).toBe(500);
    expect(readdirSync(join(dir, "sync", "vuurtoren", "devices"))).toEqual(["aaa"]);
  });

  it("with sign-in off answers this site only, and a made-up token skips no check", async () => {
    await restart({ open: true });
    const evil = { origin: "https://evil.example" };
    const pre = await fetch(file("vuurtoren/vault.json"), {
      method: "OPTIONS",
      headers: { ...evil, "access-control-request-method": "PUT" },
    });
    expect(pre.status).toBe(403);
    expect(pre.headers.get("access-control-allow-origin")).toBeNull();
    expect((await fetch(`${base}/api/sync/list?dir=`, { headers: evil })).status).toBe(403);
    expect(
      (await fetch(`${base}/api/sync/list?dir=`, { headers: { "sec-fetch-site": "cross-site" } }))
        .status,
    ).toBe(403);
    // An Authorization header with nothing to verify does not skip the CSRF check.
    const forged = await fetch(file("vuurtoren/vault.json"), {
      method: "PUT",
      headers: { authorization: "Bearer anything" },
      body: "{}",
    });
    expect(forged.status).toBe(403);
    // A device (no Origin; the X-Vuurtoren header) syncs.
    const device = await fetch(file("vuurtoren/vault.json"), {
      method: "PUT",
      headers: { authorization: "Bearer ", "x-vuurtoren": "1" },
      body: "{}",
    });
    expect(device.status).toBe(200);

    await restart({ open: true, allowedOrigins: ["https://app.example"] });
    const listed = await fetch(file("vuurtoren/vault.json"), {
      method: "OPTIONS",
      headers: { origin: "https://app.example", "access-control-request-method": "PUT" },
    });
    expect(listed.status).toBe(204);
    expect(listed.headers.get("access-control-allow-origin")).toBe("https://app.example");
  });

  it("with sign-in on, a wrong token does not skip the CSRF check", async () => {
    const res = await fetch(file("vuurtoren/vault.json"), {
      method: "PUT",
      headers: { authorization: "Bearer ksync_wrong", origin: "https://evil.example" },
      body: "{}",
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toMatch(/Request refused/);
  });
});

/** A sync place over this server's /api/sync with `token`. */
function placeFor(token: string): SyncStore {
  const h = { authorization: `Bearer ${token}` };
  const ok = async (r: Response) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r;
  };
  return {
    label: "server",
    list: async (d) =>
      (
        (await (
          await ok(
            await fetch(`${base}/api/sync/list?dir=${encodeURIComponent(d)}`, { headers: h }),
          )
        ).json()) as { names: string[] }
      ).names,
    get: async (p) => {
      const r = await fetch(file(p), { headers: h });
      return r.status === 404 ? null : new Uint8Array(await (await ok(r)).arrayBuffer());
    },
    put: async (p, b) => {
      await ok(await fetch(file(p), { method: "PUT", headers: h, body: Buffer.from(b) }));
    },
    remove: async (p) => {
      await ok(await fetch(file(p), { method: "DELETE", headers: h }));
    },
  };
}
