/**
 * Sign-in for public deployments. Single user, no dependencies.
 *
 *   POST /api/auth/login       {user, password} or {token}  -> session cookie
 *   POST /api/auth/logout      ends this browser's session
 *   POST /api/auth/logout-all  ends every session (needs to be signed in)
 *   GET  /api/auth/check       204 signed in (or auth off) / 401; nginx auth_request target
 *   GET  /api/auth/me          { authEnabled, user, via, expiresAt } or 401
 *   GET  /api/auth/mcp-tokens       list MCP tokens (Claude Code; see tokens.ts)
 *   POST /api/auth/mcp-tokens       {label?} -> { token, id, ... } (token shown once)
 *   DELETE /api/auth/mcp-tokens/:id revoke one
 *   GET/POST/DELETE /api/auth/sync-tokens[/:id]  the same for sync tokens (devices that sync)
 *
 * Credentials: a password (scrypt hash) for people, an optional bearer token for scripts and
 * the MCP server. With neither, auth is off (localhost / trusted network use).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { HttpFail, json, readJson, safeEqual } from "../http-util.js";
import { type PasswordHash, verifyPassword } from "./password.js";
import { LoginLimiter, type LimiterOptions } from "./ratelimit.js";
import { MCP_TOKENS, SYNC_TOKENS, TokenStore } from "./tokens.js";
import { SessionStore, type SessionOptions } from "./sessions.js";

type AuthMethod = "password" | "token";

const COOKIE_NAME = "kenning_session";

export interface AuthOptions {
  /** Username for password sign-in (required with `password`). */
  user?: string | undefined;
  /** Parsed scrypt hash; with `user` enables password sign-in. */
  password?: PasswordHash | undefined;
  /** Bearer token for scripts / MCP; can also be exchanged for a browser session. */
  token?: string | undefined;
  /** Session database file (default ":memory:"; the server passes KENNING_AUTH_DB). */
  sessionDb?: string;
  /** Mark the cookie `Secure` (default true; turn off only for plain-http LAN use). */
  cookieSecure?: boolean;
  /** Take the client IP from `CF-Connecting-IP` (only behind Cloudflare). */
  trustCloudflare?: boolean;
  /** Extra origins allowed to make state-changing requests besides the request's own Host. */
  allowedOrigins?: readonly string[];
  sessions?: SessionOptions;
  limiter?: LimiterOptions;
  /** Clock (tests). */
  now?: () => number;
}

/** Who made a request. */
type Identity =
  | { via: "open" }
  | { via: "token" }
  /** A per-user MCP token: valid for `/api/mcp` only. */
  | { via: "mcp"; tokenId: string }
  /** A per-device sync token: valid for `/api/sync` only. */
  | { via: "sync"; tokenId: string }
  | { via: "session"; user: string; expiresAt: number; cookie: string; renewed: boolean };

/**
 * What a request is for: MCP tokens are accepted for "mcp" (`/api/mcp`) only, sync tokens for
 * "sync" (`/api/sync`) only.
 */
type AuthScope = "api" | "mcp" | "sync";

export interface Auth {
  readonly enabled: boolean;
  readonly methods: AuthMethod[];
  /** Resolve the caller; throws HttpFail 401/429 when auth is on and the caller is unknown. */
  require(req: IncomingMessage, scope?: AuthScope): Identity;
  /** Handle `/api/auth/*`; returns false for other paths. */
  route(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean>;
  /** Why a state-changing request must be refused (CSRF), or null. */
  csrf(req: IncomingMessage): string | null;
  /** Headers to add to a response for this identity (renewed session cookie). */
  responseHeaders(id: Identity): Record<string, string | string[]>;
  close(): void;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const fingerprint = (...parts: string[]): string =>
  createHash("sha256").update(parts.join("\0")).digest("base64url");

/** Read one cookie from the Cookie header. */
function readCookie(req: IncomingMessage, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/**
 * Cross-site request forgery guard for state-changing requests (anything but GET/HEAD/
 * OPTIONS). The session cookie is SameSite=Lax already; in addition a request must
 *  - come from this site: `Origin`, when present, must match the Host (or an allowed origin),
 *    and `Sec-Fetch-Site` must not be "cross-site";
 *  - and be impossible for a plain HTML form: `Content-Type: application/json` or the
 *    `X-Kenning: 1` header (both force a CORS preflight, which this server never grants).
 * Requests with an `Authorization` header are exempt: browsers cannot attach one cross-site
 * without a preflight either, and scripts using the bearer token send no Origin.
 * Applies with auth off too (a malicious page could otherwise POST to http://localhost).
 *
 * @returns a reason when the request must be refused, else null
 */
function csrfProblem(req: IncomingMessage, allowedOrigins: readonly string[] = []): string | null {
  const method = req.method ?? "GET";
  if (SAFE_METHODS.has(method)) return null;
  if (req.headers.authorization) return null;
  if (req.headers["sec-fetch-site"] === "cross-site") return "cross-site request";
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let host: string | null;
    try {
      host = origin === "null" ? null : new URL(origin).host;
    } catch {
      // malformed Origin header: treated as no origin (the CSRF check then refuses)
      host = null;
    }
    const sameHost = host !== null && host === req.headers.host;
    const listed = allowedOrigins.includes(origin.replace(/\/$/, ""));
    if (!sameHost && !listed) return "origin does not match";
  }
  const type = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== "application/json" && req.headers["x-kenning"] !== "1") {
    return "missing application/json or X-Kenning header";
  }
  return null;
}

/** Create the auth layer. */
export function createAuth(opts: AuthOptions = {}): Auth {
  const hasPassword = Boolean(opts.password && opts.user);
  if (opts.password && !opts.user) throw new Error("A password needs a username (KENNING_USER).");
  const token = opts.token || undefined;
  const methods: AuthMethod[] = [
    ...(hasPassword ? (["password"] as const) : []),
    ...(token ? (["token"] as const) : []),
  ];
  const enabled = methods.length > 0;
  const secure = opts.cookieSecure ?? true;
  const allowed = (opts.allowedOrigins ?? []).map((o) => o.replace(/\/$/, ""));

  // Sessions remember which credential created them; changing the password, username or token
  // invalidates the sessions made with the old one.
  const pwCredential = hasPassword
    ? fingerprint(
        "password",
        opts.user!,
        opts.password!.salt.toString("base64"),
        opts.password!.hash.toString("base64"),
      )
    : null;
  const tokenCredential = token ? fingerprint("token", token) : null;
  const credentials = [pwCredential, tokenCredential].filter((c): c is string => c !== null);
  const now = opts.now ?? Date.now;
  const sessions = new SessionStore(opts.sessionDb ?? ":memory:", credentials, {
    now,
    ...opts.sessions,
  });
  const limiter = new LoginLimiter({ now, ...opts.limiter });
  const mcpTokens = new TokenStore(opts.sessionDb ?? ":memory:", MCP_TOKENS, now);
  const syncTokens = new TokenStore(opts.sessionDb ?? ":memory:", SYNC_TOKENS, now);
  const pruneTimer = setInterval(() => sessions.prune(), 3600_000);
  pruneTimer.unref();

  // One scrypt at a time: bounds memory (64 MiB each) and CPU under a flood of attempts.
  let verifyTail: Promise<unknown> = Promise.resolve();
  const verifySerial = (password: string, hash: PasswordHash): Promise<boolean> => {
    const run = verifyTail.then(() => verifyPassword(password, hash));
    verifyTail = run.catch(() => undefined);
    return run;
  };

  function clientIp(req: IncomingMessage): string {
    const pick = (v: string | string[] | undefined): string | undefined => {
      const s = (Array.isArray(v) ? v[0] : v)?.trim();
      return s && s.length <= 64 ? s : undefined;
    };
    return (
      (opts.trustCloudflare ? pick(req.headers["cf-connecting-ip"]) : undefined) ??
      pick(req.headers["x-real-ip"]) ??
      req.socket.remoteAddress ??
      "unknown"
    );
  }

  function cookie(value: string, maxAgeSec: number): string {
    return [
      `${COOKIE_NAME}=${value}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${Math.max(0, Math.floor(maxAgeSec))}`,
      ...(secure ? ["Secure"] : []),
    ].join("; ");
  }
  const sessionCookie = (id: string, expiresAt: number): string =>
    cookie(id, (expiresAt - now()) / 1000);
  const clearCookie = (): string => cookie("", 0);

  const tooMany = (retryAfterMs: number): HttpFail => {
    const s = Math.max(1, Math.ceil(retryAfterMs / 1000));
    return new HttpFail(429, "Too many sign-in attempts. Wait a moment and try again.", {
      "retry-after": String(s),
    });
  };

  /** Resolve the caller without throwing. */
  function identify(req: IncomingMessage, scope: AuthScope = "api"): Identity | HttpFail {
    if (!enabled) return { via: "open" };
    const authz = req.headers.authorization;
    if (authz !== undefined) {
      const given = /^Bearer\s+(\S+)\s*$/i.exec(authz)?.[1];
      if (given !== undefined && (token || scope !== "api")) {
        const ip = clientIp(req);
        const verdict = limiter.check(ip);
        if (!verdict.ok) return tooMany(verdict.retryAfterMs);
        if (token && safeEqual(given, token)) return { via: "token" };
        if (scope === "mcp") {
          const tokenId = mcpTokens.verify(given);
          if (tokenId) return { via: "mcp", tokenId };
        }
        if (scope === "sync") {
          const tokenId = syncTokens.verify(given);
          if (tokenId) return { via: "sync", tokenId };
        }
        limiter.fail(ip);
      }
      return new HttpFail(401, "Sign-in required.");
    }
    const id = readCookie(req, COOKIE_NAME);
    const s = sessions.lookup(id);
    if (!s || !id) return new HttpFail(401, "Sign-in required.");
    return { via: "session", user: s.user, expiresAt: s.expiresAt, cookie: id, renewed: s.renewed };
  }

  function require(req: IncomingMessage, scope: AuthScope = "api"): Identity {
    const id = identify(req, scope);
    if (id instanceof HttpFail) throw id;
    return id;
  }

  function responseHeaders(id: Identity): Record<string, string | string[]> {
    return id.via === "session" && id.renewed
      ? { "set-cookie": sessionCookie(id.cookie, id.expiresAt) }
      : {};
  }

  async function login(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!enabled) throw new HttpFail(400, "Sign-in is not enabled on this server.");
    const body = await readJson<{ user?: unknown; password?: unknown; token?: unknown }>(
      req,
      8 * 1024,
    );
    const ip = clientIp(req);
    const verdict = limiter.check(ip);
    if (!verdict.ok) throw tooMany(verdict.retryAfterMs);

    let user: string | null = null;
    let credential: string | null = null;
    if (typeof body.token === "string") {
      if (token && body.token.length <= 1024 && safeEqual(body.token, token)) {
        user = opts.user ?? "token";
        credential = tokenCredential;
      }
    } else if (typeof body.user === "string" && typeof body.password === "string") {
      if (hasPassword && body.user.length <= 256 && body.password.length <= 1024) {
        // Always run scrypt, so a wrong username costs the same time as a wrong password.
        const userOk = safeEqual(body.user.normalize("NFC"), opts.user!.normalize("NFC"));
        const passOk = await verifySerial(body.password, opts.password!);
        if (userOk && passOk) {
          user = opts.user!;
          credential = pwCredential;
        }
      }
    } else {
      throw new HttpFail(400, "Send {user, password}.");
    }

    if (user === null || credential === null) {
      limiter.fail(ip);
      console.warn(`[kenning-api] failed sign-in from ${ip}`);
      throw new HttpFail(
        401,
        typeof body.token === "string"
          ? "That access token was not accepted."
          : "Wrong username or password.",
      );
    }
    limiter.success(ip);
    const s = sessions.create(user, credential);
    json(res, 200, { ok: true, user }, { "set-cookie": sessionCookie(s.id, s.expiresAt) });
  }

  async function route(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
    if (!path.startsWith("/api/auth/")) return false;
    const method = req.method ?? "GET";
    const get = method === "GET" || method === "HEAD";

    if (path === "/api/auth/login" && method === "POST") {
      await login(req, res);
      return true;
    }
    if (path === "/api/auth/logout" && method === "POST") {
      sessions.revoke(readCookie(req, COOKIE_NAME));
      json(res, 200, { ok: true }, { "set-cookie": clearCookie() });
      return true;
    }
    if (path === "/api/auth/logout-all" && method === "POST") {
      require(req);
      const ended = sessions.revokeAll();
      console.log(`[kenning-api] signed out everywhere (${ended} sessions)`);
      json(res, 200, { ok: true, ended }, { "set-cookie": clearCookie() });
      return true;
    }
    if (path === "/api/auth/check" && get) {
      // nginx's gate passes the original URI: MCP tokens are good for /api/mcp only, sync
      // tokens for /api/sync only.
      const original = String(req.headers["x-original-uri"] ?? "");
      const scope: AuthScope = /^\/api\/mcp(?:[/?]|$)/.test(original)
        ? "mcp"
        : /^\/api\/sync(?:[/?]|$)/.test(original)
          ? "sync"
          : "api";
      const id = identify(req, scope);
      const status = id instanceof HttpFail ? id.status : 204;
      res.writeHead(status, {
        "cache-control": "no-store",
        ...(id instanceof HttpFail ? id.headers : responseHeaders(id)),
      });
      res.end();
      return true;
    }
    if (path === "/api/auth/me" && get) {
      const id = require(req);
      json(
        res,
        200,
        {
          ok: true,
          authEnabled: enabled,
          methods,
          via: id.via,
          user: id.via === "session" ? id.user : id.via === "token" ? (opts.user ?? null) : null,
          ...(id.via === "session" ? { expiresAt: id.expiresAt } : {}),
        },
        responseHeaders(id),
      );
      return true;
    }
    for (const [base, store, what] of [
      ["/api/auth/mcp-tokens", mcpTokens, "MCP"],
      ["/api/auth/sync-tokens", syncTokens, "Sync"],
    ] as const) {
      if (path !== base && !path.startsWith(`${base}/`)) continue;
      require(req);
      if (path === base && get) {
        json(res, 200, { ok: true, tokens: store.list() });
        return true;
      }
      if (path === base && method === "POST") {
        const body = await readJson<{ label?: unknown }>(req, 4 * 1024);
        let made;
        try {
          made = store.create(typeof body.label === "string" ? body.label : "");
        } catch (e) {
          throw new HttpFail(409, e instanceof Error ? e.message : "Could not make a token.");
        }
        console.log(`[kenning-api] ${what} token ${made.id} created`);
        json(res, 200, { ok: true, ...made });
        return true;
      }
      const tokenId = path.slice(base.length + 1);
      if (method === "DELETE" && /^[0-9a-f]{12}$/.test(tokenId)) {
        if (!store.revoke(tokenId)) throw new HttpFail(404, "No such token.");
        console.log(`[kenning-api] ${what} token ${tokenId} revoked`);
        json(res, 200, { ok: true });
        return true;
      }
    }
    throw new HttpFail(404, "Not found.");
  }

  return {
    enabled,
    methods,
    require,
    route,
    csrf: (req) => csrfProblem(req, allowed),
    responseHeaders,
    close() {
      clearInterval(pruneTimer);
      sessions.close();
      mcpTokens.close();
      syncTokens.close();
    },
  };
}
