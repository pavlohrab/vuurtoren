import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authFromEnv } from "./auth/config.js";
import { type AuthOptions, createAuth } from "./auth/index.js";
import { hashPassword, parsePasswordHash, verifyPassword } from "./auth/password.js";
import { LoginLimiter } from "./auth/ratelimit.js";
import { createApiServer } from "./server.js";

const FAST = { N: 2 ** 10, r: 8, p: 1 }; // cheap scrypt for tests
const DAY = 86_400_000;
const PASSWORD = "correct horse battery";

let dir: string;
let server: ReturnType<typeof createApiServer> | undefined;
let auth: ReturnType<typeof createAuth> | undefined;
let base: string;
let clock: number;
let hash: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "vuurtoren-auth-"));
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
  server = undefined;
  auth = undefined;
}

async function start(opts: Partial<AuthOptions> = {}): Promise<void> {
  auth = createAuth({
    user: "anna",
    password: parsePasswordHash(hash),
    sessionDb: join(dir, "auth.sqlite"),
    now: () => clock,
    ...opts,
  });
  server = createApiServer({ auth, syncDir: join(dir, "sync") });
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

/** "vuurtoren_session=abc" from a login response. */
function sessionOf(res: Response): string {
  const c = res.headers.getSetCookie().find((h) => h.startsWith("vuurtoren_session="));
  if (!c) throw new Error("no session cookie");
  return c.split(";")[0]!;
}

/** A state-changing request a signed-in page makes: writing a sync file. */
const write = (cookie?: string, headers: Record<string, string> = {}, type = "application/json") =>
  fetch(`${base}/api/sync/file?path=vuurtoren%2Fvault.json`, {
    method: "PUT",
    headers: { "content-type": type, ...(cookie ? { cookie } : {}), ...headers },
    body: "{}",
  });

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
    expect(() => parsePasswordHash(s)).toThrow(/VUURTOREN_PASSWORD_HASH/),
  );
});

describe("configuration from the environment", () => {
  it("is off without password and token, and says so", async () => {
    const c = await authFromEnv({});
    expect(createAuth(c.options).enabled).toBe(false);
    expect(c.warnings.join(" ")).toMatch(/Auth is OFF/);
  });

  it("hashes a plain VUURTOREN_PASSWORD stably (sessions survive restarts) and warns", async () => {
    const env = {
      VUURTOREN_USER: "anna",
      VUURTOREN_PASSWORD: "pw-pw-pw-pw",
      VUURTOREN_DATA: dir,
    };
    const a = await authFromEnv(env);
    const b = await authFromEnv(env);
    expect(a.options.password!.hash.equals(b.options.password!.hash)).toBe(true);
    expect(a.warnings.join(" ")).toMatch(/plain-text/);
    expect(a.options.sessionDb).toBe(join(dir, "auth.sqlite"));
    expect(a.options.cookieSecure).toBe(true);
  });

  it("needs a username with a password", async () => {
    await expect(authFromEnv({ VUURTOREN_PASSWORD_HASH: hash })).rejects.toThrow(/VUURTOREN_USER/);
  });

  it("reads the flags", async () => {
    const c = await authFromEnv({
      VUURTOREN_USER: "anna",
      VUURTOREN_PASSWORD_HASH: hash,
      VUURTOREN_COOKIE_SECURE: "0",
      VUURTOREN_TRUST_CF: "1",
      VUURTOREN_ALLOWED_ORIGINS: "https://a.example, https://b.example",
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
    expect(await (await fetch(`${base}/api/health`)).json()).toEqual({
      ok: true,
      service: "vuurtoren-api",
      authRequired: true,
      authMethods: ["password"],
    });
  });

  it("protects everything until signed in", async () => {
    expect((await write()).status).toBe(401);
    expect((await fetch(`${base}/api/sync/list?dir=`)).status).toBe(401);
    expect((await fetch(`${base}/api/auth/sync-tokens`)).status).toBe(401);
    expect((await fetch(`${base}/api/elsewhere`)).status).toBe(401);
    expect((await fetch(`${base}/api/auth/check`)).status).toBe(401);
    expect((await fetch(`${base}/api/auth/me`)).status).toBe(401);
  });

  it("succeeds with the right credentials and sets a hardened cookie", async () => {
    const res = await login();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, user: "anna" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    const set = res.headers.getSetCookie()[0]!;
    expect(set).toMatch(/^vuurtoren_session=[A-Za-z0-9_-]{43}; /);
    expect(set).toContain("HttpOnly");
    expect(set).toContain("Secure");
    expect(set).toContain("SameSite=Lax");
    expect(set).toContain("Path=/");
    expect(set).toContain(`Max-Age=${30 * 86_400}`);

    const cookie = sessionOf(res);
    expect((await write(cookie)).status).toBe(200);
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
    expect((await write("vuurtoren_session=" + "A".repeat(43))).status).toBe(401);
    expect((await write("vuurtoren_session=../../etc")).status).toBe(401);
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
    expect(out.headers.getSetCookie()[0]).toMatch(/^vuurtoren_session=; .*Max-Age=0/);
    expect((await write(a)).status).toBe(401);
    expect((await write(b)).status).toBe(200);
  });

  it("logout-all ends every session and needs a session itself", async () => {
    const a = sessionOf(await login());
    const b = sessionOf(await login());
    expect((await post("/api/auth/logout-all", {})).status).toBe(401);
    const res = await post("/api/auth/logout-all", {}, { cookie: a });
    expect(await res.json()).toEqual({ ok: true, ended: 2 });
    expect((await write(a)).status).toBe(401);
    expect((await write(b)).status).toBe(401);
  });

  it("expires after 30 idle days, slides on use, and ends after 180 days regardless", async () => {
    const a = sessionOf(await login());
    const b = sessionOf(await login());
    clock += 20 * DAY;
    const used = await write(a);
    expect(used.status).toBe(200);
    // the renewed expiry is sent back so the browser keeps the cookie longer
    expect(used.headers.getSetCookie()[0]).toContain(`Max-Age=${30 * 86_400}`);
    clock += 11 * DAY; // b idle for 31 days, a for 11
    expect((await write(b)).status).toBe(401);
    expect((await write(a)).status).toBe(200);
    for (let i = 0; i < 5; i++) {
      clock += 25 * DAY; // day 56, 81, 106, 131, 156
      expect((await write(a)).status).toBe(200);
    }
    clock += 25 * DAY; // day 181: past 180 days since sign-in, although used recently
    expect((await write(a)).status).toBe(401);
  });

  it("a changed password invalidates existing sessions", async () => {
    const a = sessionOf(await login());
    await stop();
    hash = await hashPassword("a whole new password", FAST);
    try {
      await start();
      expect((await write(a)).status).toBe(401);
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
    expect((await write(cookie, {}, "text/plain")).status).toBe(403);
    const formLogout = await fetch(`${base}/api/auth/logout`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: "a=b",
    });
    expect(formLogout.status).toBe(403);
    expect((await write(cookie, { origin: "https://evil.example" })).status).toBe(403);
    expect((await write(cookie, { origin: "null" })).status).toBe(403);
    expect((await write(cookie, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await login("anna", PASSWORD, { origin: "https://evil.example" })).status).toBe(403);
    expect((await write(cookie, {}, "application/octet-stream")).status).toBe(403);
    // the session still works for the real app
    expect((await write(cookie, { origin: base, "sec-fetch-site": "same-origin" })).status).toBe(
      200,
    );
  });

  it("accepts X-Vuurtoren: 1 for non-JSON bodies, and listed origins", async () => {
    const cookie = sessionOf(await login());
    expect((await write(cookie, { "x-vuurtoren": "1" }, "application/octet-stream")).status).toBe(
      200,
    );
    await stop();
    await start({ allowedOrigins: ["https://vuurtoren.example.com"] });
    const c2 = sessionOf(await login());
    expect((await write(c2, { origin: "https://vuurtoren.example.com" })).status).toBe(200);
  });

  it("guards with auth off too (a page on another site must not change sync files)", async () => {
    await stop();
    await start({ password: undefined, user: undefined });
    expect((await write(undefined, {}, "text/plain")).status).toBe(403);
    expect((await fetch(`${base}/api/auth/check`)).status).toBe(204);
  });
});

describe("bearer token", () => {
  it("keeps working for scripts next to the password", async () => {
    await start({ token: "t0ken-t0ken-t0ken-t0ken" });
    expect(await (await fetch(`${base}/api/health`)).json()).toMatchObject({
      authMethods: ["password", "token"],
    });
    const check = (t: string) =>
      fetch(`${base}/api/auth/check`, { headers: { authorization: `Bearer ${t}` } });
    expect((await check("t0ken-t0ken-t0ken-t0ken")).status).toBe(204);
    expect((await check("nope")).status).toBe(401);
    // no CSRF header needed with Authorization (scripts)
    const bearer = { authorization: "Bearer t0ken-t0ken-t0ken-t0ken" };
    expect((await write(undefined, bearer, "application/octet-stream")).status).toBe(200);
    // Only a token that is valid skips the check: a wrong one is refused like a form.
    const forged = { authorization: "Bearer not-the-token", origin: "https://evil.example" };
    expect((await write(undefined, forged, "application/octet-stream")).status).toBe(403);
  });

  it("with auth off, an Authorization header skips no check", async () => {
    await start({ user: undefined, password: undefined });
    const h = { authorization: "Bearer anything" };
    expect((await write(undefined, h, "application/octet-stream")).status).toBe(403);
  });

  it("can be exchanged for a browser session (token-only servers)", async () => {
    await start({ user: undefined, password: undefined, token: "t0ken-t0ken-t0ken-t0ken" });
    expect((await post("/api/auth/login", { token: "bad" })).status).toBe(401);
    const res = await post("/api/auth/login", { token: "t0ken-t0ken-t0ken-t0ken" });
    expect(res.status).toBe(200);
    expect((await write(sessionOf(res))).status).toBe(200);
  });

  it("wrong tokens count towards the rate limit", async () => {
    await start({ token: "t0ken-t0ken-t0ken-t0ken" });
    const h = { authorization: "Bearer guess", "x-real-ip": "203.0.113.1" };
    for (let i = 0; i < 4; i++) expect((await write(undefined, h)).status).toBe(401);
    expect((await write(undefined, h)).status).toBe(429);
  });
});

describe("sessions stay out of the sync files", () => {
  it("keeps sessions in their own file, never next to the synced data", async () => {
    await start();
    const cookie = sessionOf(await login());
    expect((await write(cookie)).status).toBe(200);
    expect(existsSync(join(dir, "auth.sqlite"))).toBe(true);
    expect(existsSync(join(dir, "sync", "vuurtoren", "vault.json"))).toBe(true);
    expect(readdirSync(join(dir, "sync"))).toEqual(["vuurtoren"]);
  });
});
