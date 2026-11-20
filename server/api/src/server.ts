/**
 * HTTP surface of the Kenning API (node:http, no framework).
 *
 *   GET  /api/health   open; { ok, service, state, authRequired, authMethods, schemaVersion }
 *   *    /api/auth/*   sign-in, sign-out, session check (see auth/index.ts)
 *   GET  /api/info     size, event count, device id
 *   POST /api/rpc      { method, args } -> { ok, result } (allow-listed repository methods)
 *   POST /api/blobs    raw image or sound body (images at most 2 MB, sounds 8 MB) -> { ok, id }
 *   GET  /api/blobs/:id  a stored image (cover photos; content-addressed, cached privately)
 *   GET  /api/export   consistent snapshot, kenning-YYYY-MM-DD.sqlite
 *   POST /api/import   raw SQLite body replaces the database
 *   POST /api/mcp      MCP over Streamable HTTP (Claude Code; see mcp.ts). Also accepts a
 *                      per-user MCP token, which opens nothing else.
 *   GET  /api/sync/list?dir=   names in a sync folder        (see sync.ts: sealed files of
 *   GET  /api/sync/file?path=  a sync file                     devices that keep their own
 *   PUT  /api/sync/file?path=  write one (raw body)            data; also accepts a sync
 *   DELETE /api/sync/file?path=  remove one                    token, which opens nothing else)
 *   A sync token writes only its own device's folder and images; with auth off, /api/sync
 *   answers this site and KENNING_ALLOWED_ORIGINS only.
 *
 * When auth is on (password and/or token) every endpoint except health and the
 * sign-in routes needs a session cookie or `Authorization: Bearer <token>`. State-changing
 * requests are CSRF-checked in every mode.
 */
import { createReadStream, rmSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  BackupError,
  MAX_AUDIO_BLOB_BYTES,
  MAX_BLOB_BYTES,
  SCHEMA_VERSION,
  blobProblem,
  isBlobId,
  backupFilename,
  encodeRpcResult,
  isRpcMethod,
  isSchemaTooNew,
  validateRpcArgs,
} from "@app/db";
import { type Auth, type AuthScope, type Identity, createAuth } from "./auth/index.js";
import { HttpFail, json, readBody, streamBodyToFile } from "./http-util.js";
import { createMcpEndpoint, type McpEndpointOptions, nlpAnalyzer } from "./mcp.js";
import type { Store } from "./store.js";
import { MAX_SYNC_FILE_BYTES, SyncFiles, syncPath, syncWriteProblem } from "./sync.js";
import { dirname, join } from "node:path";

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
  /** Folder of the sync files (default: `sync` next to the database file). */
  syncDir?: string;
  /** Most bytes all sync files together may take (KENNING_SYNC_QUOTA_MB; default 2 GB). */
  syncQuotaBytes?: number | undefined;
}

/**
 * Cross-origin access to `/api/sync` with a token (no cookies): browsers syncing from elsewhere.
 * With auth off there is no token to ask for, so only the allowed origins are answered.
 */
function syncCors(req: IncomingMessage, auth: Auth): Record<string, string> {
  const origin = req.headers.origin;
  if (!origin) return {};
  if (!auth.enabled && !auth.allowedOrigins.includes(origin.replace(/\/$/, ""))) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, PUT, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, x-kenning",
    "access-control-max-age": "600",
    vary: "Origin",
  };
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
  const sync = new SyncFiles(
    opts.syncDir ?? join(dirname(store.path), "sync"),
    opts.syncQuotaBytes,
  );
  const mcp = createMcpEndpoint({
    store,
    analyze: opts.analyze ?? (opts.nlpUrl ? nlpAnalyzer(opts.nlpUrl) : undefined),
  });

  async function handleSync(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
    method: string,
    who: Identity,
    headers: Record<string, string | string[]>,
  ): Promise<void> {
    const q = new URL(req.url ?? "/", "http://x").searchParams;
    if (path === "/api/sync/list" && method === "GET") {
      return json(res, 200, { ok: true, names: sync.list(syncPath(q.get("dir"), true)) }, headers);
    }
    if (path === "/api/sync/file") {
      const parts = syncPath(q.get("path"));
      if (method === "GET") {
        const bytes = sync.get(parts);
        if (!bytes) throw new HttpFail(404, "No such file.");
        res.writeHead(200, {
          "content-type": "application/octet-stream",
          "content-length": bytes.length,
          "cache-control": "no-store",
          ...headers,
        });
        res.end(bytes);
        return;
      }
      if (method === "PUT" || method === "DELETE") {
        const done = mayWrite(who, parts, method);
        if (method === "PUT")
          sync.put(parts, new Uint8Array(await readBody(req, MAX_SYNC_FILE_BYTES)));
        else sync.remove(parts);
        done();
        return json(res, 200, { ok: true }, headers);
      }
    }
    throw new HttpFail(404, "Not found.");
  }

  /**
   * Refuse (403) a write a sync token may not make; a session, the server's own token and an
   * open server may write anything. A token's first device folder becomes its own here; the
   * returned function notes, once the write went through, that the token made the vault.
   */
  function mayWrite(who: Identity, parts: string[], method: "PUT" | "DELETE"): () => void {
    if (who.via !== "sync") return () => undefined;
    const rights = auth.syncTokens.get(who.tokenId);
    if (!rights) throw new HttpFail(401, "Sign-in required.");
    const verdict = syncWriteProblem(parts, method, rights, sync.exists(parts));
    if ("problem" in verdict) throw new HttpFail(403, verdict.problem);
    if (verdict.claim) {
      // Two first writes at once to different folders: one of them wins.
      if (!auth.syncTokens.claimDevice(who.tokenId, verdict.claim)) {
        throw new HttpFail(403, "This sync token belongs to another device.");
      }
      console.log(`[kenning-api] sync token ${who.tokenId} is now device ${verdict.claim}`);
    }
    return () => {
      if (verdict.madeVault) auth.syncTokens.allowVault(who.tokenId);
    };
  }

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
    if (path.startsWith("/api/sync/")) {
      // With auth off nothing tells a device from a page on another site: only this site and
      // the allowed origins may sync.
      const foreign = auth.enabled ? null : auth.foreignOrigin(req);
      if (foreign) {
        throw new HttpFail(
          403,
          `Sync from another site needs sign-in on this server, or KENNING_ALLOWED_ORIGINS (${foreign}).`,
        );
      }
      if (method === "OPTIONS") {
        res.writeHead(204, syncCors(req, auth));
        res.end();
        return;
      }
    }

    const scope: AuthScope =
      path === "/api/mcp" ? "mcp" : path.startsWith("/api/sync/") ? "sync" : "api";
    const csrf = auth.csrf(req, scope);
    if (csrf) throw new HttpFail(403, `Request refused (${csrf}).`);
    if (await auth.route(req, res, path)) return;

    if (path === "/api/mcp") {
      auth.require(req, "mcp");
      return mcp(req, res);
    }

    if (path.startsWith("/api/sync/")) {
      const cors = syncCors(req, auth);
      try {
        const who = auth.require(req, "sync");
        return await handleSync(req, res, path, method, who, {
          ...cors,
          ...auth.responseHeaders(who),
        });
      } catch (e) {
        if (e instanceof HttpFail)
          throw new HttpFail(e.status, e.message, { ...e.headers, ...cors });
        throw e;
      }
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

    if (path === "/api/blobs" && method === "POST") {
      const type = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
      const cap = type.startsWith("image/") ? MAX_BLOB_BYTES : MAX_AUDIO_BLOB_BYTES;
      const bytes = new Uint8Array(await readBody(req, cap));
      const problem = blobProblem(bytes, type);
      if (problem) throw new HttpFail(400, problem);
      const blobId = await store.withRepo((repo) => repo.putBlob(bytes, type));
      return json(res, 200, { ok: true, id: blobId }, extra);
    }

    if (path.startsWith("/api/blobs/") && method === "GET") {
      const blobId = path.slice("/api/blobs/".length);
      if (!isBlobId(blobId)) throw new HttpFail(404, "Not found.");
      const blob = await store.withRepo((repo) => repo.getBlob(blobId));
      if (!blob) throw new HttpFail(404, "Not found.");
      res.writeHead(200, {
        "content-type": blob.type,
        "content-length": blob.bytes.length,
        // Content-addressed: the bytes behind an id never change.
        "cache-control": "private, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
        // An SVG must never run script when opened directly.
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        ...extra,
      });
      res.end(blob.bytes);
      return;
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
