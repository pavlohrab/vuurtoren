/** `/api/sync`: sealed files of devices, opened by a session or a sync token (and nothing else). */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAuth } from "./auth/index.js";
import { hashPassword, parsePasswordHash } from "./auth/password.js";
import { createApiServer } from "./server.js";
import { openStore, type Store } from "./store.js";
import { syncPath } from "./sync.js";
import { type SyncStore, createRepository, openVault, syncOnce } from "@app/db";
import { createNodeDriver } from "@app/db/node";

const PASSWORD = "correct horse battery";
let dir: string;
let store: Store;
let server: ReturnType<typeof createApiServer>;
let auth: ReturnType<typeof createAuth>;
let base: string;
let hash: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "kenning-sync-"));
  hash ??= await hashPassword(PASSWORD, { N: 2 ** 10, r: 8, p: 1 });
  store = await openStore(join(dir, "kenning.sqlite"));
  auth = createAuth({
    user: "anna",
    password: parsePasswordHash(hash),
    sessionDb: join(dir, "auth.sqlite"),
    limiter: { freeFailures: 100 },
  });
  server = createApiServer({ store, auth });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await new Promise((r) => server.close(r));
  auth.close();
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

async function session(): Promise<string> {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ user: "anna", password: PASSWORD }),
  });
  return /kenning_session=[^;]+/.exec(res.headers.get("set-cookie") ?? "")![0];
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

    const put = await fetch(file("kenning/devices/abc/01J.kev"), {
      method: "PUT",
      headers: bearer,
      body: bytes,
    });
    expect(put.status).toBe(200);
    const list = await fetch(`${base}/api/sync/list?dir=kenning/devices`, { headers: bearer });
    expect(await list.json()).toEqual({ ok: true, names: ["abc"] });
    const got = await fetch(file("kenning/devices/abc/01J.kev"), { headers: bearer });
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes);
    expect((await fetch(file("kenning/vault.json"), { headers: bearer })).status).toBe(404);
    expect(
      (await fetch(file("kenning/devices/abc/01J.kev"), { method: "DELETE", headers: bearer }))
        .status,
    ).toBe(200);
    expect(existsSync(join(dir, "sync", "kenning", "devices", "abc", "01J.kev"))).toBe(false);

    // A sync token opens nothing else; a revoked one nothing at all.
    expect((await fetch(`${base}/api/info`, { headers: bearer })).status).toBe(401);
    const revoked = await fetch(`${base}/api/auth/sync-tokens/${id}`, {
      method: "DELETE",
      headers: { cookie, "x-kenning": "1" },
    });
    expect(revoked.status).toBe(200);
    expect((await fetch(`${base}/api/sync/list?dir=`, { headers: bearer })).status).toBe(401);
  });

  it("works with a session on the same site, and refuses anyone else", async () => {
    const cookie = await session();
    const ok = await fetch(file("kenning/vault.json"), {
      method: "PUT",
      headers: { cookie, "x-kenning": "1" },
      body: new TextEncoder().encode("{}"),
    });
    expect(ok.status).toBe(200);
    expect((await fetch(`${base}/api/sync/list?dir=kenning`)).status).toBe(401);
    const mcp = await fetch(`${base}/api/auth/mcp-tokens`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: "{}",
    });
    const { token } = (await mcp.json()) as { token: string };
    // An MCP token does not open sync.
    expect(
      (
        await fetch(`${base}/api/sync/list?dir=kenning`, {
          headers: { authorization: `Bearer ${token}` },
        })
      ).status,
    ).toBe(401);
  });

  it("answers browsers elsewhere (CORS) and refuses paths outside its folder", async () => {
    const { token } = await syncToken(await session());
    const pre = await fetch(file("kenning/vault.json"), {
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
    expect(() => syncPath("kenning/devices/a1/01J.base.kev")).not.toThrow();
  });

  it("carries two devices' changes with the real sync engine", async () => {
    const { token } = await syncToken(await session());
    const h = { authorization: `Bearer ${token}` };
    const store: SyncStore = {
      label: "server",
      list: async (d) =>
        (
          (await (
            await fetch(`${base}/api/sync/list?dir=${encodeURIComponent(d)}`, { headers: h })
          ).json()) as {
            names: string[];
          }
        ).names,
      get: async (p) => {
        const r = await fetch(file(p), { headers: h });
        return r.status === 404 ? null : new Uint8Array(await r.arrayBuffer());
      },
      put: async (p, b) => {
        expect((await fetch(file(p), { method: "PUT", headers: h, body: Buffer.from(b) })).ok).toBe(
          true,
        );
      },
      remove: async (p) => {
        await fetch(file(p), { method: "DELETE", headers: h });
      },
    };
    const a = await createRepository(await createNodeDriver(), { deviceId: "aaaaaaaaaaaa" });
    const b = await createRepository(await createNodeDriver(), { deviceId: "bbbbbbbbbbbb" });
    const key = await openVault(store, "lange zinnen lezen", true, 1000);
    await a.append({ type: "WordStateSet", lang: "nl", key: "fiets", state: "known" });
    expect(await syncOnce(a, store, key, { deviceName: "Laptop" })).toMatchObject({ sent: 1 });
    expect(await syncOnce(b, store, key, { deviceName: "Phone" })).toMatchObject({ received: 1 });
    expect((await b.word("nl", "fiets"))?.state).toBe("known");
  });
});
