/**
 * HTTP surface of the Kenning API (node:http, no framework).
 *
 *   GET  /api/health   open; { ok, service, state, authRequired, authMethods, schemaVersion }
 *   *    /api/auth/*   sign-in, sign-out, session check (see auth/index.ts)
 *   GET  /api/info     size, event count, device id
 *   POST /api/rpc      { method, args } -> { ok, result } (allow-listed repository methods)
 *   GET  /api/export   consistent snapshot, kenning-YYYY-MM-DD.sqlite
 *   POST /api/import   raw SQLite body replaces the database
 *   POST /api/mcp      MCP over Streamable HTTP (Claude Code; see mcp.ts). Also accepts a
 *                      per-user MCP token, which opens nothing else.
 *
 * When auth is on (password and/or token, ADR 0009) every endpoint except health and the
 * sign-in routes needs a session cookie or `Authorization: Bearer <token>`. State-changing
 * requests are CSRF-checked in every mode.
 */
import { createReadStream, rmSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  BackupError,
  SCHEMA_VERSION,
  backupFilename,
  encodeRpcResult,
  isRpcMethod,
  isSchemaTooNew,
  validateRpcArgs,
} from "@app/db";
import { type Auth, createAuth } from "./auth/index.js";
import { HttpFail, json, readBody, streamBodyToFile } from "./http-util.js";
import { createMcpEndpoint, type McpEndpointOptions, nlpAnalyzer } from "./mcp.js";
import type { Store } from "./store.js";

export interface ApiOptions {
  store: Store;
  /** Sign-in layer; defaults to bearer-only auth from `token` (or none). */
  auth?: Auth;
  /** Bearer token when `auth` is not given; empty or undefined disables authentication. */
  token?: string | undefined;
  /** Largest accepted import (backup) body in bytes (default 512 MiB); streamed to disk. */
  maxBodyBytes?: number;
  /** Largest accepted `/api/rpc` body in bytes (default 32 MiB); held in memory. */
  maxRpcBytes?: number;
  /** NLP service address for the MCP tools that analyse text (KENNING_NLP_URL). */
  nlpUrl?: string | undefined;
  /** Analyser override (tests); defaults to the NLP service at `nlpUrl`. */
  analyze?: McpEndpointOptions["analyze"];
}

/** Default cap of an import body (a whole database backup). */
const DEFAULT_MAX_IMPORT_BYTES = 512 * 1024 * 1024;
/** Default cap of one RPC body: the largest event is an analysed book (tokens), well below this. */
const DEFAULT_MAX_RPC_BYTES = 32 * 1024 * 1024;

/** Create (not yet listening) the API server. */
export function createApiServer(opts: ApiOptions): Server {
  const { store } = opts;
  const auth = opts.auth ?? createAuth({ token: opts.token });
  const maxBody = opts.maxBodyBytes ?? DEFAULT_MAX_IMPORT_BYTES;
  const maxRpc = Math.min(opts.maxRpcBytes ?? DEFAULT_MAX_RPC_BYTES, maxBody);
  const mcp = createMcpEndpoint({
    store,
    analyze: opts.analyze ?? (opts.nlpUrl ? nlpAnalyzer(opts.nlpUrl) : undefined),
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    const method = req.method ?? "GET";

    if (path === "/api/health" && method === "GET") {
      return json(res, 200, {
        ok: true,
        service: "kenning-api",
        state: store.state,
        authRequired: auth.enabled,
        authMethods: auth.methods,
        schemaVersion: SCHEMA_VERSION,
        ...(store.foundVersion === undefined ? {} : { foundVersion: store.foundVersion }),
      });
    }
    if (!path.startsWith("/api/")) throw new HttpFail(404, "Not found.");

    const csrf = auth.csrf(req);
    if (csrf) throw new HttpFail(403, `Request refused (${csrf}).`);
    if (await auth.route(req, res, path)) return;

    if (path === "/api/mcp") {
      auth.require(req, "mcp");
      return mcp(req, res);
    }

    const id = auth.require(req);
    const extra = auth.responseHeaders(id);

    if (path === "/api/info" && method === "GET") return json(res, 200, await store.info(), extra);

    if (path === "/api/rpc" && method === "POST") {
      let body: { method?: unknown; args?: unknown };
      try {
        body = JSON.parse((await readBody(req, maxRpc)).toString("utf8")) as typeof body;
      } catch (err) {
        if (err instanceof HttpFail) throw err;
        throw new HttpFail(400, "Body must be JSON.");
      }
      if (!isRpcMethod(body.method)) throw new HttpFail(400, "Unknown method.");
      const args = body.args ?? [];
      const problem = validateRpcArgs(body.method, args);
      if (problem) throw new HttpFail(400, problem);
      const name = body.method;
      const result = await store.withRepo((repo) => {
        const fn = repo[name] as (...a: unknown[]) => Promise<unknown>;
        return fn.apply(repo, args as unknown[]);
      });
      const value = encodeRpcResult(result);
      return json(
        res,
        200,
        value === undefined ? { ok: true } : { ok: true, result: value },
        extra,
      );
    }

    if (path === "/api/export" && method === "GET") {
      const { file, cleanup } = await store.snapshot();
      res.writeHead(200, {
        "content-type": "application/vnd.sqlite3",
        "content-length": statSync(file).size,
        "content-disposition": `attachment; filename="${backupFilename()}"`,
        "cache-control": "no-store",
        ...extra,
      });
      const stream = createReadStream(file);
      stream.on("close", cleanup);
      stream.on("error", () => res.destroy());
      stream.pipe(res);
      return;
    }

    if (path === "/api/import" && method === "POST") {
      // Streamed to a file next to the database, so a large backup never sits in memory.
      const file = store.uploadPath();
      try {
        await streamBodyToFile(req, file, maxBody);
        await store.importBackupFile(file);
      } finally {
        rmSync(file, { force: true });
      }
      return json(res, 200, { ok: true }, extra);
    }

    throw new HttpFail(path.startsWith("/api/") ? 404 : 405, "Not found.");
  }

  return createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (res.headersSent) return void res.destroy();
      if (err instanceof HttpFail) {
        return json(res, err.status, { ok: false, error: err.message }, err.headers);
      }
      if (err instanceof BackupError || isSchemaTooNew(err)) {
        return json(res, 422, { ok: false, error: (err as Error).message });
      }
      console.error("[kenning-api]", err);
      json(res, 500, { ok: false, error: err instanceof Error ? err.message : "Server error." });
    });
  });
}
