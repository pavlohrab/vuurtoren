import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AnalyzedToken } from "@app/core";
import { createAuth } from "./auth/index.js";
import { hashPassword, parsePasswordHash } from "./auth/password.js";
import { createApiServer } from "./server.js";
import { openStore, type Store } from "./store.js";

const PASSWORD = "correct horse battery";
const TOKEN = "server-token-0123456789";

let dir: string;
let store: Store;
let server: ReturnType<typeof createApiServer>;
let auth: ReturnType<typeof createAuth>;
let base: string;
let hash: string;

const tokenize = (text: string): Promise<AnalyzedToken[]> =>
  Promise.resolve(
    [...text.matchAll(/\p{L}+/gu)].map((m, i) => ({
      i,
      text: m[0],
      lemma: m[0].toLowerCase(),
      alt_lemmas: [],
      pos: "NOUN",
      morph: "",
      dep: "",
      head: i,
      sent: 0,
      start: m.index,
      end: m.index + m[0].length,
      is_word: true,
      is_propn: false,
      is_num: false,
      particle_of: null,
      zipf: 4,
    })),
  );

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "vuurtoren-mcp-"));
  hash ??= await hashPassword(PASSWORD, { N: 2 ** 10, r: 8, p: 1 });
  store = await openStore(join(dir, "vuurtoren.sqlite"));
  auth = createAuth({
    user: "anna",
    password: parsePasswordHash(hash),
    token: TOKEN,
    sessionDb: join(dir, "auth.sqlite"),
    limiter: { freeFailures: 100 },
  });
  server = createApiServer({ store, auth, analyze: tokenize });
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
  return /vuurtoren_session=[^;]+/.exec(res.headers.get("set-cookie") ?? "")![0];
}

const jsonPost = (path: string, body: unknown, headers: Record<string, string>) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

async function connect(token: string): Promise<Client> {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

describe("MCP tokens", () => {
  it("are made and revoked by a signed-in user, stored only as a hash", async () => {
    const cookie = await session();
    const made = (await (
      await jsonPost("/api/auth/mcp-tokens", { label: "Laptop" }, { cookie })
    ).json()) as { token: string; id: string; label: string };
    expect(made.token).toMatch(/^kmcp_[A-Za-z0-9_-]{43}$/);
    expect(made.label).toBe("Laptop");
    expect(readFileSync(join(dir, "auth.sqlite")).includes(made.token)).toBe(false);

    const list = (await (
      await fetch(`${base}/api/auth/mcp-tokens`, { headers: { cookie } })
    ).json()) as {
      tokens: { id: string; lastUsedAt: number | null }[];
    };
    expect(list.tokens.map((t) => t.id)).toEqual([made.id]);

    // Not without a sign-in, and an MCP token is no sign-in for the rest of the API.
    expect((await fetch(`${base}/api/auth/mcp-tokens`)).status).toBe(401);
    const bearer = { authorization: `Bearer ${made.token}` };
    expect((await fetch(`${base}/api/auth/mcp-tokens`, { headers: bearer })).status).toBe(401);
    expect((await jsonPost("/api/rpc", { method: "listTexts" }, bearer)).status).toBe(401);
    expect((await fetch(`${base}/api/info`, { headers: bearer })).status).toBe(401);

    // nginx's gate: the token passes /api/auth/check only for /api/mcp.
    const check = (uri: string) =>
      fetch(`${base}/api/auth/check`, { headers: { ...bearer, "x-original-uri": uri } });
    expect((await check("/api/mcp")).status).toBe(204);
    expect((await check("/api/rpc")).status).toBe(401);
    expect((await check("/api/mcpx")).status).toBe(401);

    const revoke = await fetch(`${base}/api/auth/mcp-tokens/${made.id}`, {
      method: "DELETE",
      headers: { cookie, "x-vuurtoren": "1" },
    });
    expect(revoke.status).toBe(200);
    expect((await check("/api/mcp")).status).toBe(401);
    const again = await fetch(`${base}/api/auth/mcp-tokens/${made.id}`, {
      method: "DELETE",
      headers: { cookie, "x-vuurtoren": "1" },
    });
    expect(again.status).toBe(404);
  });
});

describe("/api/mcp", () => {
  it("serves the tools to an MCP client with an MCP token; VUURTOREN_TOKEN works too", async () => {
    const cookie = await session();
    const { token } = (await (await jsonPost("/api/auth/mcp-tokens", {}, { cookie })).json()) as {
      token: string;
    };

    const client = await connect(token);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("save_text");
    expect(names).toContain("suggest_words_for_anki");
    expect(names).not.toContain("add_to_anki");

    const saved = await client.callTool({
      name: "save_text",
      arguments: { title: "Op de fiets", content: "Ik fiets naar huis.", topic: "cycling" },
    });
    expect(saved.isError).toBeFalsy();
    const { textId } = JSON.parse((saved.content as { text: string }[])[0]!.text) as {
      textId: string;
    };
    const text = await store.withRepo((r) => r.getText(textId));
    expect(text).toMatchObject({ title: "Op de fiets", sourceKind: "ai", analyzed: true });

    const sug = await client.callTool({
      name: "suggest_words_for_anki",
      arguments: { words: [{ word: "de fiets", gloss: "bike" }] },
    });
    expect(sug.isError).toBeFalsy();
    expect(await store.withRepo((r) => r.suggestedWords("nl"))).toMatchObject([
      { key: "fiets", by: "claude-code" },
    ]);
    await client.close();

    const viaServerToken = await connect(TOKEN);
    const listed = await viaServerToken.callTool({ name: "list_texts", arguments: {} });
    expect(JSON.stringify(listed.content)).toContain("Op de fiets");
    await viaServerToken.close();
  });

  it("refuses requests without a valid token", async () => {
    await expect(connect("kmcp_" + "x".repeat(43))).rejects.toThrow();
    const res = await jsonPost(
      "/api/mcp",
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      { accept: "application/json, text/event-stream" },
    );
    expect(res.status).toBe(401);
  });
});

describe("nginx template", () => {
  it("routes /api/mcp through the sign-in gate, unbuffered", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const conf = readFileSync(join(here, "../../../deploy/nginx.conf.template"), "utf8");
    const block = /location = \/api\/mcp \{([\s\S]*?)\n {4}\}/.exec(conf)?.[1] ?? "";
    expect(block).toContain("auth_request /_vuurtoren_auth;");
    expect(block).toContain("proxy_buffering off;");
    expect(block).toContain("proxy_set_header Authorization $http_authorization;");
    // The gate passes the original URI, so the api can accept MCP tokens for /api/mcp only.
    expect(conf).toMatch(/location = \/_vuurtoren_auth \{[\s\S]*?X-Original-URI \$request_uri/);
  });
});
