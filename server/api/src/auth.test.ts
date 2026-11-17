import { existsSync, mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHttpAdmin, createHttpRepository, fetchServerHealth } from "@app/db/http";
import { authFromEnv } from "./auth/config.js";
import { type AuthOptions, createAuth } from "./auth/index.js";
import { hashPassword, parsePasswordHash, verifyPassword } from "./auth/password.js";
import { LoginLimiter } from "./auth/ratelimit.js";
import { createApiServer } from "./server.js";
import { openStore, type Store } from "./store.js";

const FAST = { N: 2 ** 10, r: 8, p: 1 }; // cheap scrypt for tests
const DAY = 86_400_000;
const PASSWORD = "correct horse battery";

let dir: string;
let store: Store;
let server: ReturnType<typeof createApiServer> | undefined;
let auth: ReturnType<typeof createAuth> | undefined;
let base: string;
let clock: number;
let hash: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "kenning-auth-"));
  clock = Date.UTC(2026, 0, 1);
  hash ??= await hashPassword(PASSWORD, FAST);
});
afterEach(async () => {
  await stop();
  rmSync(dir, { recursive: true, force: true });
});

async function stop(): Promise<void> {
  if (server) await new Promise((r) => server!.close(r));
  auth?.close();
  await store?.close();
  server = undefined;
  auth = undefined;
}

async function start(opts: Partial<AuthOptions> = {}): Promise<void> {
  store = await openStore(join(dir, "kenning.sqlite"));
  auth = createAuth({
    user: "anna",
    password: parsePasswordHash(hash),
    sessionDb: join(dir, "auth.sqlite"),
    now: () => clock,
    ...opts,
  });
  server = createApiServer({ store, auth });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const login = (user = "anna", password = PASSWORD, headers: Record<string, string> = {}) =>
  post("/api/auth/login", { user, password }, headers);

/** "kenning_session=abc" from a login response. */
function sessionOf(res: Response): string {
  const c = res.headers.getSetCookie().find((h) => h.startsWith("kenning_session="));
  if (!c) throw new Error("no session cookie");
  return c.split(";")[0]!;
}

const rpc = (cookie?: string, headers: Record<string, string> = {}) =>
  post("/api/rpc", { method: "listTexts", args: [] }, cookie ? { cookie, ...headers } : headers);

describe("password hashing", () => {
  it("round-trips and rejects a wrong password", async () => {
    const h = parsePasswordHash(await hashPassword("geheim wachtwoord", FAST));
    expect(await verifyPassword("geheim wachtwoord", h)).toBe(true);
    expect(await verifyPassword("geheim wachtwoorD", h)).toBe(false);
  });

  it("uses a self-describing format without $ and also reads the $ form", async () => {
    const s = await hashPassword("x", FAST);
    expect(s).toMatch(/^scrypt:1024:8:1:[\w-]+:[\w-]+$/);
    expect(await verifyPassword("x", parsePasswordHash(s.replaceAll(":", "$")))).toBe(true);
  });

  it.each([
    "",
    "bcrypt:1:2:3:aa:bb",
    "scrypt:1000:8:1:c2FsdHNhbHQ:aGFzaGhhc2hoYXNoaGFzaA",
    "scrypt:1024:8:1:!!:??",
  ])("refuses the malformed hash %j", (s) =>
    expect(() => parsePasswordHash(s)).toThrow(/KENNING_PASSWORD_HASH/),
  );
});

describe("configuration from the environment", () => {
  it("is off without password and token, and says so", async () => {
    const c = await authFromEnv({});
    expect(createAuth(c.options).enabled).toBe(false);
    expect(c.warnings.join(" ")).toMatch(/Auth is OFF/);
  });

  it("hashes a plain KENNING_PASSWORD stably (sessions survive restarts) and warns", async () => {
    const env = {
      KENNING_USER: "anna",
      KENNING_PASSWORD: "pw-pw-pw-pw",
      KENNING_DB: join(dir, "k.sqlite"),
    };
    const a = await authFromEnv(env);
    const b = await authFromEnv(env);
    expect(a.options.password!.hash.equals(b.options.password!.hash)).toBe(true);
    expect(a.warnings.join(" ")).toMatch(/plain-text/);
    expect(a.options.sessionDb).toBe(join(dir, "auth.sqlite"));
    expect(a.options.cookieSecure).toBe(true);
  });

  it("needs a username with a password", async () => {
    await expect(authFromEnv({ KENNING_PASSWORD_HASH: hash })).rejects.toThrow(/KENNING_USER/);
  });

  it("reads the flags", async () => {
    const c = await authFromEnv({
      KENNING_USER: "anna",
      KENNING_PASSWORD_HASH: hash,
      KENNING_COOKIE_SECURE: "0",
      KENNING_TRUST_CF: "1",
      KENNING_ALLOWED_ORIGINS: "https://a.example, https://b.example",
    });
    expect(c.options).toMatchObject({
      cookieSecure: false,
      trustCloudflare: true,
      allowedOrigins: ["https://a.example", "https://b.example"],
    });
  });
});

describe("sign-in", () => {
  beforeEach(() => start());

  it("health is open and announces the methods", async () => {
    expect(await fetchServerHealth(base)).toMatchObject({
      authRequired: true,
      authMethods: ["password"],
    });
  });

  it("protects the data until signed in", async () => {
    expect((await rpc()).status).toBe(401);
    expect((await fetch(`${base}/api/export`)).status).toBe(401);
    expect((await fetch(`${base}/api/info`)).status).toBe(401);
    expect((await fetch(`${base}/api/auth/check`)).status).toBe(401);
    expect((await fetch(`${base}/api/auth/me`)).status).toBe(401);
  });

  it("succeeds with the right credentials and sets a hardened cookie", async () => {
    const res = await login();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, user: "anna" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    const set = res.headers.getSetCookie()[0]!;
    expect(set).toMatch(/^kenning_session=[A-Za-z0-9_-]{43}; /);
    expect(set).toContain("HttpOnly");
    expect(set).toContain("Secure");
    expect(set).toContain("SameSite=Lax");
    expect(set).toContain("Path=/");
    expect(set).toContain(`Max-Age=${30 * 86_400}`);

    const cookie = sessionOf(res);
    expect((await rpc(cookie)).status).toBe(200);
    expect((await fetch(`${base}/api/auth/check`, { headers: { cookie } })).status).toBe(204);
    const me = await fetch(`${base}/api/auth/me`, { headers: { cookie } });
    expect(await me.json()).toMatchObject({ user: "anna", via: "session", authEnabled: true });
  });

  it("stores only a hash of the session id, in its own file", async () => {
    const cookie = sessionOf(await login());
    const id = cookie.split("=")[1]!;
    const db = new DatabaseSync(join(dir, "auth.sqlite"));
    const rows = db.prepare("SELECT * FROM sessions").all() as { id_hash: Uint8Array }[];
    db.close();
    expect(rows).toHaveLength(1);
    expect(Buffer.from(rows[0]!.id_hash).toString("utf8")).not.toContain(id);
    expect(Buffer.from(rows[0]!.id_hash)).toHaveLength(32);
  });

  it.each([
    ["wrong password", "anna", "nope nope"],
    ["wrong user", "bob", PASSWORD],
    ["empty", "", ""],
  ])("fails generically (%s)", async (_why, user, password) => {
    const res = await login(user, password);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "Wrong username or password." });
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("rejects malformed bodies and forged cookies", async () => {
    expect((await post("/api/auth/login", { user: 1 })).status).toBe(400);
    expect((await rpc("kenning_session=" + "A".repeat(43))).status).toBe(401);
    expect((await rpc("kenning_session=../../etc")).status).toBe(401);
  });

  it("can turn the Secure flag off for plain-http LAN use", async () => {
    await stop();
    await start({ cookieSecure: false });
    expect((await login()).headers.getSetCookie()[0]).not.toContain("Secure");
  });

  it("logout ends this session and clears the cookie", async () => {
    const a = sessionOf(await login());
    const b = sessionOf(await login());
    const out = await post("/api/auth/logout", {}, { cookie: a });
    expect(out.status).toBe(200);
    expect(out.headers.getSetCookie()[0]).toMatch(/^kenning_session=; .*Max-Age=0/);
    expect((await rpc(a)).status).toBe(401);
    expect((await rpc(b)).status).toBe(200);
  });

  it("logout-all ends every session and needs a session itself", async () => {
    const a = sessionOf(await login());
    const b = sessionOf(await login());
    expect((await post("/api/auth/logout-all", {})).status).toBe(401);
    const res = await post("/api/auth/logout-all", {}, { cookie: a });
    expect(await res.json()).toEqual({ ok: true, ended: 2 });
    expect((await rpc(a)).status).toBe(401);
    expect((await rpc(b)).status).toBe(401);
  });

  it("expires after 30 idle days, slides on use, and ends after 180 days regardless", async () => {
    const a = sessionOf(await login());
    const b = sessionOf(await login());
    clock += 20 * DAY;
    const used = await rpc(a);
    expect(used.status).toBe(200);
    // the renewed expiry is sent back so the browser keeps the cookie longer
    expect(used.headers.getSetCookie()[0]).toContain(`Max-Age=${30 * 86_400}`);
    clock += 11 * DAY; // b idle for 31 days, a for 11
    expect((await rpc(b)).status).toBe(401);
    expect((await rpc(a)).status).toBe(200);
    for (let i = 0; i < 5; i++) {
      clock += 25 * DAY; // day 56, 81, 106, 131, 156
      expect((await rpc(a)).status).toBe(200);
    }
    clock += 25 * DAY; // day 181: past 180 days since sign-in, although used recently
    expect((await rpc(a)).status).toBe(401);
  });

  it("a changed password invalidates existing sessions", async () => {
    const a = sessionOf(await login());
    await stop();
    hash = await hashPassword("a whole new password", FAST);
    try {
      await start();
      expect((await rpc(a)).status).toBe(401);
    } finally {
      hash = await hashPassword(PASSWORD, FAST);
    }
  });
});

describe("brute-force protection", () => {
  it("backs off exponentially per IP, then lets the owner in again", async () => {
    await start();
    const ip = { "x-real-ip": "203.0.113.7" };
    for (let i = 0; i < 3; i++) expect((await login("anna", "bad", ip)).status).toBe(401);
    expect((await login("anna", "bad", ip)).status).toBe(401); // 4th: starts a 1 s wait
    const blocked = await login("anna", PASSWORD, ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("1");
    expect(((await blocked.json()) as { error: string }).error).toMatch(/Too many/);
    // another IP is not affected
    expect((await login("anna", PASSWORD, { "x-real-ip": "198.51.100.2" })).status).toBe(200);
    clock += 1001;
    expect((await login("anna", "bad", ip)).status).toBe(401); // 5th: 2 s
    clock += 1500;
    expect((await login("anna", PASSWORD, ip)).status).toBe(429);
    clock += 600;
    expect((await login("anna", PASSWORD, ip)).status).toBe(200);
    // success resets the counter
    expect((await login("anna", "bad", ip)).status).toBe(401);
    expect((await login("anna", "bad", ip)).status).toBe(401);
    expect((await login("anna", PASSWORD, ip)).status).toBe(200);
  });

  it("caps failures globally across IPs", async () => {
    await start({ limiter: { globalMax: 5, globalWindowMs: 60_000 } });
    for (let i = 0; i < 5; i++) {
      expect((await login("anna", "bad", { "x-real-ip": `192.0.2.${i}` })).status).toBe(401);
    }
    expect((await login("anna", PASSWORD, { "x-real-ip": "192.0.2.99" })).status).toBe(429);
    clock += 60_001;
    expect((await login("anna", PASSWORD, { "x-real-ip": "192.0.2.99" })).status).toBe(200);
  });

  it("uses CF-Connecting-IP only when told to trust Cloudflare", async () => {
    await start();
    // Not trusted: all three requests share X-Real-IP (the tunnel), whatever CF says.
    for (let i = 0; i < 4; i++) {
      await login("anna", "bad", { "x-real-ip": "10.0.0.2", "cf-connecting-ip": `203.0.113.${i}` });
    }
    expect(
      (
        await login("anna", PASSWORD, {
          "x-real-ip": "10.0.0.2",
          "cf-connecting-ip": "203.0.113.50",
        })
      ).status,
    ).toBe(429);
    await stop();
    await start({ trustCloudflare: true });
    for (let i = 0; i < 4; i++) {
      await login("anna", "bad", { "x-real-ip": "10.0.0.2", "cf-connecting-ip": "203.0.113.9" });
    }
    expect(
      (
        await login("anna", PASSWORD, {
          "x-real-ip": "10.0.0.2",
          "cf-connecting-ip": "203.0.113.9",
        })
      ).status,
    ).toBe(429);
    expect(
      (
        await login("anna", PASSWORD, {
          "x-real-ip": "10.0.0.2",
          "cf-connecting-ip": "203.0.113.10",
        })
      ).status,
    ).toBe(200);
  });

  it("limiter unit: forgets old failures", () => {
    let t = 0;
    const l = new LoginLimiter({ now: () => t, freeFailures: 0, forgetAfterMs: 1000 });
    l.fail("a");
    expect(l.check("a").ok).toBe(false);
    t = 5000;
    expect(l.check("a").ok).toBe(true);
    l.fail("a"); // counted from scratch: 1 s again, not 2 s
    t = 6001;
    expect(l.check("a").ok).toBe(true);
  });
});

describe("CSRF", () => {
  beforeEach(() => start());

  it("refuses state-changing requests a plain form or other site could send", async () => {
    const cookie = sessionOf(await login());
    const form = await fetch(`${base}/api/rpc`, {
      method: "POST",
      headers: { cookie, "content-type": "text/plain" },
      body: JSON.stringify({ method: "listTexts", args: [] }),
    });
    expect(form.status).toBe(403);
    const formLogout = await fetch(`${base}/api/auth/logout`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: "a=b",
    });
    expect(formLogout.status).toBe(403);
    expect((await rpc(cookie, { origin: "https://evil.example" })).status).toBe(403);
    expect((await rpc(cookie, { origin: "null" })).status).toBe(403);
    expect((await rpc(cookie, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await login("anna", PASSWORD, { origin: "https://evil.example" })).status).toBe(403);
    const importForm = await fetch(`${base}/api/import`, {
      method: "POST",
      headers: { cookie, "content-type": "application/octet-stream" },
      body: "x",
    });
    expect(importForm.status).toBe(403);
    // the session still works for the real app
    expect((await rpc(cookie, { origin: base, "sec-fetch-site": "same-origin" })).status).toBe(200);
  });

  it("accepts X-Kenning: 1 for non-JSON bodies, and listed origins", async () => {
    const cookie = sessionOf(await login());
    const res = await fetch(`${base}/api/import`, {
      method: "POST",
      headers: { cookie, "content-type": "application/octet-stream", "x-kenning": "1" },
      body: "not a database",
    });
    expect(res.status).toBe(422); // passed the guard, then failed validation
    await stop();
    await start({ allowedOrigins: ["https://kenning.example.com"] });
    const c2 = sessionOf(await login());
    expect((await rpc(c2, { origin: "https://kenning.example.com" })).status).toBe(200);
  });

  it("guards with auth off too (a page on another site must not wipe local data)", async () => {
    await stop();
    await start({ password: undefined, user: undefined });
    const res = await fetch(`${base}/api/import`, { method: "POST", body: "x" });
    expect(res.status).toBe(403);
    expect((await fetch(`${base}/api/auth/check`)).status).toBe(204);
  });
});

describe("bearer token", () => {
  it("keeps working for scripts and the MCP server next to the password", async () => {
    await start({ token: "t0ken-t0ken-t0ken-t0ken" });
    expect(await fetchServerHealth(base)).toMatchObject({ authMethods: ["password", "token"] });
    const repo = await createHttpRepository(base, "t0ken-t0ken-t0ken-t0ken");
    expect(await repo.listTexts()).toEqual([]);
    await expect(createHttpRepository(base, "wrong")).rejects.toMatchObject({ status: 401 });
    const check = (t: string) =>
      fetch(`${base}/api/auth/check`, { headers: { authorization: `Bearer ${t}` } });
    expect((await check("t0ken-t0ken-t0ken-t0ken")).status).toBe(204);
    expect((await check("nope")).status).toBe(401);
    // no CSRF header needed with Authorization (scripts): import with octet-stream
    const imp = await fetch(`${base}/api/import`, {
      method: "POST",
      headers: { authorization: "Bearer t0ken-t0ken-t0ken-t0ken" },
      body: "x",
    });
    expect(imp.status).toBe(422);
  });

  it("can be exchanged for a browser session (token-only servers)", async () => {
    await start({ user: undefined, password: undefined, token: "t0ken-t0ken-t0ken-t0ken" });
    expect((await post("/api/auth/login", { token: "bad" })).status).toBe(401);
    const res = await post("/api/auth/login", { token: "t0ken-t0ken-t0ken-t0ken" });
    expect(res.status).toBe(200);
    expect((await rpc(sessionOf(res))).status).toBe(200);
  });

  it("wrong tokens count towards the rate limit", async () => {
    await start({ token: "t0ken-t0ken-t0ken-t0ken" });
    const h = { authorization: "Bearer guess", "x-real-ip": "203.0.113.1" };
    for (let i = 0; i < 4; i++) expect((await rpc(undefined, h)).status).toBe(401);
    expect((await rpc(undefined, h)).status).toBe(429);
  });
});

describe("sessions and backups are separate", () => {
  it("export never contains sessions and import keeps everyone signed in", async () => {
    await start();
    const cookie = sessionOf(await login());
    expect(existsSync(join(dir, "auth.sqlite"))).toBe(true);
    const exp = await fetch(`${base}/api/export`, { headers: { cookie } });
    const bytes = new Uint8Array(await exp.arrayBuffer());
    const copy = join(dir, "exported.sqlite");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(copy, bytes);
    const db = new DatabaseSync(copy);
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    db.close();
    expect(tables).not.toContain("sessions");

    // restore through the admin client using the cookie
    const admin = createHttpAdmin(base, undefined, (url, init) =>
      fetch(url, { ...init, headers: { ...(init?.headers as Record<string, string>), cookie } }),
    );
    await admin.importBackup(bytes);
    expect((await rpc(cookie)).status).toBe(200);
  });
});
