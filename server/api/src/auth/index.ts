/**
 * Sign-in for public deployments. Single user, no dependencies.
 *
 *   POST /api/auth/login       {user, password} or {token}  -> session cookie
 *   POST /api/auth/logout      ends this browser's session
 *   POST /api/auth/logout-all  ends every session (needs to be signed in)
 *   GET  /api/auth/check       204 signed in (or auth off) / 401; nginx auth_request target
 *   GET  /api/auth/me          { authEnabled, user, via, expiresAt } or 401
 *   GET  /api/auth/sync-tokens       list sync tokens (devices that sync; see tokens.ts)
 *   POST /api/auth/sync-tokens       {label?, vault?} -> { token, id, ... } (token shown once)
 *   DELETE /api/auth/sync-tokens/:id revoke one
 *   POST /api/sync/pair-code         a one-time pairing code (signed in; see tokens.ts)
 *   POST /api/sync/pair              {code, name} -> { token, id, label } (no sign-in: the code)
 *                                    or {user, password, name}: a device signs in by itself
 *
 * Credentials: a password (scrypt hash) for people, an optional bearer token for scripts.
 * With neither, auth is off (localhost / trusted network use).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { HttpFail, json, readJson, safeEqual } from "../http-util.js";
import { type PasswordHash, verifyPassword } from "./password.js";
import { LoginLimiter, type LimiterOptions } from "./ratelimit.js";
import { PAIR_CODE_MS, TokenStore } from "./tokens.js";
import { SessionStore, type SessionOptions } from "./sessions.js";

type AuthMethod = "password" | "token";

const COOKIE_NAME = "vuurtoren_session";

export interface AuthOptions {
  /** Username for password sign-in (required with `password`). */
  user?: string | undefined;
  /** Parsed scrypt hash; with `user` enables password sign-in. */
  password?: PasswordHash | undefined;
  /** Bearer token for scripts; can also be exchanged for a browser session. */
  token?: string | undefined;
  /** Session database file (default ":memory:"; the server passes VUURTOREN_AUTH_DB). */
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
export type Identity =
  | { via: "open" }
  | { via: "token" }
  /** A per-device sync token: valid for `/api/sync` and `/nlp/` only. */
  | { via: "sync"; tokenId: string }
  | { via: "session"; user: string; expiresAt: number; cookie: string; renewed: boolean };

/**
 * What a request is for: sync tokens are accepted for "sync" (`/api/sync`) and "nlp" (the
 * language server behind nginx's `/nlp/`), never for "api".
 */
type AuthScope = "api" | "sync" | "nlp";

export interface Auth {
  readonly enabled: boolean;
  readonly methods: AuthMethod[];
  /** Resolve the caller; throws HttpFail 401/429 when auth is on and the caller is unknown. */
  require(req: IncomingMessage, scope?: AuthScope): Identity;
  /** Handle `/api/auth/*`; returns false for other paths. */
  route(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean>;
  /**
   * Why a state-changing request must be refused (CSRF), or null. `scope` is what the request
   * is for: a bearer token skips the check only when it is valid there.
   */
  csrf(req: IncomingMessage, scope?: AuthScope): string | null;
  /** Why the request comes from another site (not this host, not an allowed origin), or null. */
  foreignOrigin(req: IncomingMessage): string | null;
  /** Extra origins allowed besides the server's own (VUURTOREN_ALLOWED_ORIGINS). */
  readonly allowedOrigins: readonly string[];
  /** The sync tokens (each bound to a device; see tokens.ts). */
  readonly syncTokens: TokenStore;
  /** `POST /api/sync/pair-code`: a pairing code for a phone (needs to be signed in). */
  pairCode(req: IncomingMessage, res: ServerResponse): void;
  /**
   * `POST /api/sync/pair` with `{code, name}`: the code buys a new sync token labelled `name`.
   * Needs no sign-in (the code is the credential) and is rate limited like sign-in.
   */
  pair(req: IncomingMessage, res: ServerResponse, headers: Record<string, string>): Promise<void>;
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

/** Why `req` comes from another site, or null (no Origin, this host, or a listed origin). */
function originProblem(req: IncomingMessage, allowedOrigins: readonly string[]): string | null {
  if (req.headers["sec-fetch-site"] === "cross-site") return "cross-site request";
  const origin = req.headers.origin;
  if (origin === undefined) return null;
  let host: string | null;
  try {
    host = origin === "null" ? null : new URL(origin).host;
  } catch {
    // A malformed Origin header counts as another site.
    host = null;
  }
  const sameHost = host !== null && host === req.headers.host;
  const listed = allowedOrigins.includes(origin.replace(/\/$/, ""));
  return sameHost || listed ? null : "origin does not match";
}

/**
 * Cross-site request forgery guard for state-changing requests (anything but GET/HEAD/
 * OPTIONS). The session cookie is SameSite=Lax already; in addition a request must
 *  - come from this site: `Origin`, when present, must match the Host (or an allowed origin),
 *    and `Sec-Fetch-Site` must not be "cross-site";
 *  - and be impossible for a plain HTML form: `Content-Type: application/json` or the
 *    `X-Vuurtoren: 1` header (both force a CORS preflight, which this server never grants).
 * Requests with a valid bearer token (`bearerOk`) are exempt: browsers cannot attach one
 * cross-site without a preflight either, and scripts using a token send no Origin. Any other
 * Authorization header (auth off, a wrong token) is checked like everything else.
 * Applies with auth off too (a malicious page could otherwise POST to http://localhost).
 *
 * @returns a reason when the request must be refused, else null
 */
function csrfProblem(
  req: IncomingMessage,
  allowedOrigins: readonly string[],
  bearerOk: boolean,
): string | null {
  const method = req.method ?? "GET";
  if (SAFE_METHODS.has(method)) return null;
  if (bearerOk) return null;
  const foreign = originProblem(req, allowedOrigins);
  if (foreign) return foreign;
  const type = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== "application/json" && req.headers["x-vuurtoren"] !== "1") {
    return "missing application/json or X-Vuurtoren header";
  }
  return null;
}

/** Create the auth layer. */
export function createAuth(opts: AuthOptions = {}): Auth {
  const hasPassword = Boolean(opts.password && opts.user);
  if (opts.password && !opts.user) throw new Error("A password needs a username (VUURTOREN_USER).");
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
  // Wrong pairing codes: their own limit, so guessing codes does not lock out sign-in.
  const pairLimiter = new LoginLimiter({ now, ...opts.limiter });
  const syncTokens = new TokenStore(opts.sessionDb ?? ":memory:", now);
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

  // One answer per request and scope: the CSRF check and the endpoint ask the same question,
  // and a wrong token counts once towards the rate limit.
  const identified = new WeakMap<IncomingMessage, Map<AuthScope, Identity | HttpFail>>();
  function identify(req: IncomingMessage, scope: AuthScope = "api"): Identity | HttpFail {
    let known = identified.get(req);
    if (!known) identified.set(req, (known = new Map()));
    const hit = known.get(scope);
    if (hit) return hit;
    const id = resolve(req, scope);
    known.set(scope, id);
    return id;
  }

  /** Resolve the caller without throwing. */
  function resolve(req: IncomingMessage, scope: AuthScope): Identity | HttpFail {
    if (!enabled) return { via: "open" };
    const authz = req.headers.authorization;
    if (authz !== undefined) {
      const given = /^Bearer\s+(\S+)\s*$/i.exec(authz)?.[1];
      if (given !== undefined && (token || scope !== "api")) {
        const ip = clientIp(req);
        const verdict = limiter.check(ip);
        if (!verdict.ok) return tooMany(verdict.retryAfterMs);
        if (token && safeEqual(given, token)) return { via: "token" };
        if (scope !== "api") {
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
      console.warn(`[vuurtoren-api] failed sign-in from ${ip}`);
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

  /** A device's own sign-in: the server's user and password, under the sign-in limit. */
  async function deviceSignIn(ip: string, user: string, password: string): Promise<void> {
    if (!enabled || !hasPassword) {
      throw new HttpFail(400, "This server has no password to sign in with. Use a pairing code.");
    }
    const verdict = limiter.check(ip);
    if (!verdict.ok) throw tooMany(verdict.retryAfterMs);
    const ok =
      user.length <= 256 &&
      password.length <= 1024 &&
      // Always run scrypt, so a wrong username costs the same time as a wrong password.
      (await verifySerial(password, opts.password!)) &&
      safeEqual(user.normalize("NFC"), opts.user!.normalize("NFC"));
    if (!ok) {
      limiter.fail(ip);
      console.warn(`[vuurtoren-api] failed device sign-in from ${ip}`);
      throw new HttpFail(401, "Wrong username or password.");
    }
    limiter.success(ip);
  }

  function pairCode(req: IncomingMessage, res: ServerResponse): void {
    const id = require(req);
    const made = syncTokens.newPairCode();
    console.log("[vuurtoren-api] pairing code made");
    json(res, 200, { ok: true, ...made, validMs: PAIR_CODE_MS }, responseHeaders(id));
  }

  async function pair(
    req: IncomingMessage,
    res: ServerResponse,
    headers: Record<string, string>,
  ): Promise<void> {
    // JSON only: a plain HTML form cannot send it, and a browser asks first (CORS).
    const type = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
    if (type !== "application/json") throw new HttpFail(415, "Send the pairing code as JSON.");
    const ip = clientIp(req);
    const verdict = pairLimiter.check(ip);
    if (!verdict.ok) {
      const s = Math.max(1, Math.ceil(verdict.retryAfterMs / 1000));
      throw new HttpFail(429, "Too many pairing attempts. Wait a moment and try again.", {
        "retry-after": String(s),
      });
    }
    const body = await readJson<{
      code?: unknown;
      user?: unknown;
      password?: unknown;
      name?: unknown;
    }>(req, 8 * 1024);
    const name = typeof body.name === "string" ? body.name : "Phone";
    // A device signs in with the server's user name and password: checked as at sign-in (and
    // limited the same way), then it gets a token of its own, as with a pairing code.
    if (typeof body.user === "string" && typeof body.password === "string") {
      await deviceSignIn(ip, body.user, body.password);
      const made = syncTokens.pair(syncTokens.newPairCode().code, name);
      if (!made) throw new HttpFail(500, "Could not make a token.");
      console.log(`[vuurtoren-api] sync token ${made.id} created by signing in`);
      return json(res, 200, { ok: true, token: made.token, id: made.id, label: made.label }, headers);
    }
    if (typeof body.code !== "string") throw new HttpFail(400, "Send {code, name}.");
    let made;
    try {
      made = syncTokens.pair(body.code.slice(0, 64), name);
    } catch (e) {
      throw new HttpFail(409, e instanceof Error ? e.message : "Could not make a token.");
    }
    if (!made) {
      pairLimiter.fail(ip);
      console.warn(`[vuurtoren-api] wrong pairing code from ${ip}`);
      throw new HttpFail(
        403,
        "This pairing code does not work: it was used already, it expired, or a character is wrong. Make a new one on the server's Your devices page.",
      );
    }
    pairLimiter.success(ip);
    console.log(`[vuurtoren-api] sync token ${made.id} created by pairing`);
    json(res, 200, { ok: true, token: made.token, id: made.id, label: made.label }, headers);
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
      console.log(`[vuurtoren-api] signed out everywhere (${ended} sessions)`);
      json(res, 200, { ok: true, ended }, { "set-cookie": clearCookie() });
      return true;
    }
    if (path === "/api/auth/check" && get) {
      // nginx's gate passes the original URI: a sync token opens /api/sync and the language
      // server (/nlp/), nothing else.
      const original = String(req.headers["x-original-uri"] ?? "");
      const scope: AuthScope = /^\/api\/sync(?:[/?]|$)/.test(original)
        ? "sync"
        : /^\/nlp\//.test(original)
          ? "nlp"
          : "api";
      // A browser's CORS preflight to the language server carries no credentials and reads
      // nothing: it may pass (the language server answers it for its allowed origins).
      if (scope === "nlp" && req.headers["x-original-method"] === "OPTIONS") {
        res.writeHead(204, { "cache-control": "no-store" });
        res.end();
        return true;
      }
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
    const base = "/api/auth/sync-tokens";
    if (path === base || path.startsWith(`${base}/`)) {
      require(req);
      if (path === base && get) {
        json(res, 200, { ok: true, tokens: syncTokens.list() });
        return true;
      }
      if (path === base && method === "POST") {
        const body = await readJson<{ label?: unknown; vault?: unknown }>(req, 4 * 1024);
        let made;
        try {
          made = syncTokens.create(typeof body.label === "string" ? body.label : "", {
            vault: body.vault === true,
          });
        } catch (e) {
          throw new HttpFail(409, e instanceof Error ? e.message : "Could not make a token.");
        }
        console.log(`[vuurtoren-api] sync token ${made.id} created`);
        json(res, 200, { ok: true, ...made });
        return true;
      }
      const tokenId = path.slice(base.length + 1);
      if (method === "DELETE" && /^[0-9a-f]{12}$/.test(tokenId)) {
        if (!syncTokens.revoke(tokenId)) throw new HttpFail(404, "No such token.");
        console.log(`[vuurtoren-api] sync token ${tokenId} revoked`);
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
    csrf: (req, scope = "api") =>
      csrfProblem(
        req,
        allowed,
        enabled &&
          req.headers.authorization !== undefined &&
          !(identify(req, scope) instanceof HttpFail),
      ),
    foreignOrigin: (req) => originProblem(req, allowed),
    allowedOrigins: allowed,
    syncTokens,
    pairCode,
    pair,
    responseHeaders,
    close() {
      clearInterval(pruneTimer);
      sessions.close();
      syncTokens.close();
    },
  };
}
