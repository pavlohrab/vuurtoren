/** Pairing a phone: a one-time code from a signed-in page buys the phone its own sync token. */
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAuth } from "./auth/index.js";
import { hashPassword, parsePasswordHash } from "./auth/password.js";
import { PAIR_CODE_MS, TokenStore, normalizePairCode } from "./auth/tokens.js";
import { createApiServer } from "./server.js";

const PASSWORD = "correct horse battery";
let dir: string;
let hash: string;
let server: ReturnType<typeof createApiServer>;
let auth: ReturnType<typeof createAuth>;
let base: string;
let clock = 1_000_000;
let served = false;

async function serve(limiter: { freeFailures?: number } = { freeFailures: 100 }) {
  auth = createAuth({
    user: "anna",
    password: parsePasswordHash(hash),
    sessionDb: join(dir, "auth.sqlite"),
    limiter,
    now: () => clock,
  });
  server = createApiServer({ auth, syncDir: join(dir, "sync") });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  served = true;
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "vuurtoren-pair-"));
  hash ??= await hashPassword(PASSWORD, { N: 2 ** 10, r: 8, p: 1 });
  clock = 1_000_000;
});
afterEach(async () => {
  if (served) {
    await new Promise((r) => server.close(r));
    auth.close();
    served = false;
  }
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

async function pairCode(headers: Record<string, string>) {
  return fetch(`${base}/api/sync/pair-code`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: "{}",
  });
}

async function pair(code: string, name = "Phone (Pixel 8)", headers: Record<string, string> = {}) {
  return fetch(`${base}/api/sync/pair`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ code, name }),
  });
}

async function newCode(): Promise<string> {
  const res = await pairCode({ cookie: await session() });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { code: string; expiresAt: number };
  expect(body.expiresAt).toBe(clock + PAIR_CODE_MS);
  return body.code;
}

describe("pairing", () => {
  it("trades a code once for a sync token that opens /api/sync and is listed", async () => {
    await serve();
    const code = await newCode();
    expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    const res = await pair(code.toLowerCase().replace("-", " "));
    expect(res.status).toBe(200);
    const made = (await res.json()) as { token: string; id: string; label: string };
    expect(made.label).toBe("Phone (Pixel 8)");
    expect(made.token).toMatch(/^ksync_/);
    const list = await fetch(`${base}/api/sync/list?dir=`, {
      headers: { authorization: `Bearer ${made.token}` },
    });
    expect(list.status).toBe(200);
    const tokens = await fetch(`${base}/api/auth/sync-tokens`, {
      headers: { cookie: await session() },
    });
    const listed = (await tokens.json()) as { tokens: { id: string; label: string }[] };
    expect(listed.tokens.map((t) => t.label)).toEqual(["Phone (Pixel 8)"]);
    // Used once: the same code does nothing the second time.
    expect((await pair(code)).status).toBe(403);
  });

  it("refuses a code after ten minutes, and a wrong one", async () => {
    await serve();
    const code = await newCode();
    clock += PAIR_CODE_MS;
    expect((await pair(code)).status).toBe(403);
    expect((await pair("AAAAA-AAAAA")).status).toBe(403);
    expect((await pair("not a code at all")).status).toBe(403);
    const fresh = await newCode();
    clock += PAIR_CODE_MS - 1;
    expect((await pair(fresh)).status).toBe(200);
  });

  it("makes codes only for a signed-in page, never for a sync token or a stranger", async () => {
    await serve();
    expect((await pairCode({})).status).toBe(401);
    const made = (await (await pair(await newCode())).json()) as { token: string };
    expect((await pairCode({ authorization: `Bearer ${made.token}` })).status).toBe(401);
    // A page on another site cannot use the session to make one.
    expect(
      (await pairCode({ cookie: await session(), origin: "https://evil.example" })).status,
    ).toBe(403);
  });

  it("answers a phone or another site with CORS, and only JSON", async () => {
    await serve();
    const code = await newCode();
    const pre = await fetch(`${base}/api/sync/pair`, {
      method: "OPTIONS",
      headers: { origin: "http://tauri.localhost", "access-control-request-method": "POST" },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-methods")).toContain("POST");
    const form = await fetch(`${base}/api/sync/pair`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `code=${code}`,
    });
    expect(form.status).toBe(415);
    const res = await pair(code, "Phone", { origin: "http://tauri.localhost" });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://tauri.localhost");
  });

  it("slows down guessing", async () => {
    await serve({ freeFailures: 3 });
    for (let i = 0; i < 4; i++) expect((await pair("AAAAA-AAAAA")).status).toBe(403);
    const blocked = await pair(await newCode());
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    // Guessing codes does not lock the owner out of signing in.
    expect(await session()).toMatch(/vuurtoren_session=/);
  });
});

describe("a device signing in by itself", () => {
  const signIn = (user: string, password: string) =>
    fetch(`${base}/api/sync/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user, password, name: "Desktop (Arch)" }),
    });

  it("gets its own sync token with the server's user name and password", async () => {
    await serve();
    const res = await signIn("anna", PASSWORD);
    expect(res.status).toBe(200);
    const made = (await res.json()) as { token: string; label: string };
    expect(made.token).toMatch(/^ksync_/);
    expect(made.label).toBe("Desktop (Arch)");
    const list = await fetch(`${base}/api/sync/list?dir=`, {
      headers: { authorization: `Bearer ${made.token}` },
    });
    expect(list.status).toBe(200);
  });

  it("is refused with a wrong password, and slowed down like sign-in", async () => {
    await serve({ freeFailures: 2 });
    expect((await signIn("anna", "wrong")).status).toBe(401);
    expect((await signIn("bob", PASSWORD)).status).toBe(401);
    expect((await signIn("anna", "wrong")).status).toBe(401);
    expect((await signIn("anna", PASSWORD)).status).toBe(429);
  });
});

describe("pairing codes in the token store", () => {
  it("keeps only the hash, at most five codes, and ignores case and dashes", () => {
    const store = new TokenStore(":memory:", () => clock);
    const codes = Array.from({ length: 6 }, () => store.newPairCode().code);
    // The oldest was dropped for the sixth.
    expect(store.pair(codes[0]!, "A")).toBeNull();
    expect(store.pair(normalizePairCode(codes[5]!).toLowerCase(), "B")?.label).toBe("B");
    expect(store.pair(codes[1]!, "")?.label).toBe("A device");
    store.close();
  });
});
