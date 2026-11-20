/**
 * HTTP surface of the Vuurtoren API (node:http, no framework). A Vuurtoren server holds no learner
 * data: it signs you in and is a sync place for your devices.
 *
 *   GET  /api/health   open; { ok, service, authRequired, authMethods }
 *   *    /api/auth/*   sign-in, sign-out, session check, sync tokens (see auth/index.ts)
 *   GET  /api/sync/list?dir=   names in a sync folder        (see sync.ts: sealed files of
 *   GET  /api/sync/file?path=  a sync file                     your devices; also accepts a
 *   PUT  /api/sync/file?path=  write one (raw body)            sync token, which opens
 *   DELETE /api/sync/file?path=  remove one                    nothing else)
 *   A sync token writes only its own device's folder and images; with auth off, /api/sync
 *   answers this site and VUURTOREN_ALLOWED_ORIGINS only.
 *
 * When auth is on (password and/or token) every endpoint except health and the sign-in routes
 * needs a session cookie or `Authorization: Bearer <token>`. State-changing requests are
 * CSRF-checked in every mode.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { type Auth, type Identity, createAuth } from "./auth/index.js";
import { HttpFail, json, readBody } from "./http-util.js";
import { MAX_SYNC_FILE_BYTES, SyncFiles, syncPath, syncWriteProblem } from "./sync.js";

export interface ApiOptions {
  /** Folder of the sync files. */
  syncDir: string;
  /** Sign-in layer; defaults to bearer-only auth from `token` (or none). */
  auth?: Auth;
  /** Bearer token when `auth` is not given; empty or undefined disables authentication. */
  token?: string | undefined;
  /** Most bytes all sync files together may take (VUURTOREN_SYNC_QUOTA_MB; default 2 GB). */
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
    "access-control-allow-headers": "authorization, content-type, x-vuurtoren",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}

/** Create (not yet listening) the API server. */
export function createApiServer(opts: ApiOptions): Server {
  const auth = opts.auth ?? createAuth({ token: opts.token });
  const sync = new SyncFiles(opts.syncDir, opts.syncQuotaBytes);

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
      console.log(`[vuurtoren-api] sync token ${who.tokenId} is now device ${verdict.claim}`);
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
        service: "vuurtoren-api",
        authRequired: auth.enabled,
        authMethods: auth.methods,
      });
    }
    if (!path.startsWith("/api/")) throw new HttpFail(404, "Not found.");
    const isSync = path.startsWith("/api/sync/");
    if (isSync) {
      // With auth off nothing tells a device from a page on another site: only this site and
      // the allowed origins may sync.
      const foreign = auth.enabled ? null : auth.foreignOrigin(req);
      if (foreign) {
        throw new HttpFail(
          403,
          `Sync from another site needs sign-in on this server, or VUURTOREN_ALLOWED_ORIGINS (${foreign}).`,
        );
      }
      if (method === "OPTIONS") {
        res.writeHead(204, syncCors(req, auth));
        res.end();
        return;
      }
    }

    const csrf = auth.csrf(req, isSync ? "sync" : "api");
    if (csrf) throw new HttpFail(403, `Request refused (${csrf}).`);
    if (await auth.route(req, res, path)) return;

    if (isSync) {
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

    auth.require(req);
    throw new HttpFail(404, "Not found.");
  }

  return createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (res.headersSent) return void res.destroy();
      if (err instanceof HttpFail) {
        return json(res, err.status, { ok: false, error: err.message }, err.headers);
      }
      console.error("[vuurtoren-api]", err);
      json(res, 500, { ok: false, error: err instanceof Error ? err.message : "Server error." });
    });
  });
}
