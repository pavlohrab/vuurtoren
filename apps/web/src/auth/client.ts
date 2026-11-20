/**
 * Browser side of sign-in (server/api/src/auth). The session lives in an HttpOnly
 * cookie the page cannot read; this module only calls the endpoints and interprets answers.
 */

export type AuthMethod = "password" | "token";

/** Body of `GET /api/health` on a Vuurtoren server (never needs a sign-in). */
export interface ServerHealth {
  ok: true;
  service: "vuurtoren-api";
  /** True when requests need a sign-in session (cookie) or `Authorization: Bearer <token>`. */
  authRequired: boolean;
  /** How one can sign in. */
  authMethods?: AuthMethod[];
}

/** Who is signed in (GET /api/auth/me). */
export interface Account {
  authEnabled: boolean;
  user: string | null;
  via: "session" | "token" | "open";
  expiresAt?: number;
}

export type Credentials = { user: string; password: string } | { token: string };

export type SignInResult =
  | { ok: true; user: string | null }
  | {
      ok: false;
      kind: "invalid" | "rate-limited" | "unavailable" | "refused";
      message: string;
      /** Seconds until another attempt is allowed (rate-limited). */
      retryAfter?: number;
    };

export interface AuthClient {
  /** The signed-in account; null when not signed in (401). Throws when the server fails. */
  me(): Promise<Account | null>;
  signIn(c: Credentials): Promise<SignInResult>;
  signOut(): Promise<void>;
  signOutAll(): Promise<void>;
}

type FetchLike = typeof fetch;
const ambientFetch: FetchLike = (...args) => globalThis.fetch(...args);

const JSON_POST = (body: unknown): RequestInit => ({
  method: "POST",
  credentials: "same-origin",
  headers: { "content-type": "application/json", "x-vuurtoren": "1" },
  body: JSON.stringify(body),
});

async function errorText(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : null;
  } catch {
    // no JSON error body: the caller uses its generic message (expected)
    return null;
  }
}

/**
 * Ask the page's own server whether it is a Vuurtoren server. Any other answer (404, an HTML
 * page from a SPA fallback, a network error, a timeout) is null.
 */
export async function fetchServerHealth(
  fetchImpl: FetchLike = ambientFetch,
  timeoutMs = 2000,
): Promise<ServerHealth | null> {
  try {
    const res = await fetchImpl("/api/health", {
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<ServerHealth> | null;
    return body?.ok === true && body.service === "vuurtoren-api" ? (body as ServerHealth) : null;
  } catch {
    // Nothing answered: no Vuurtoren server here (expected for a plain page).
    return null;
  }
}

export function createAuthClient(
  base: string = "",
  fetchImpl: FetchLike = ambientFetch,
): AuthClient {
  return {
    async me() {
      const res = await fetchImpl(`${base}/api/auth/me`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (res.status === 401) return null;
      if (!res.ok) throw new Error(`The server answered ${res.status}.`);
      const body = (await res.json()) as Account;
      return {
        authEnabled: body.authEnabled,
        user: body.user ?? null,
        via: body.via,
        ...(body.expiresAt ? { expiresAt: body.expiresAt } : {}),
      };
    },

    async signIn(c) {
      let res: Response;
      try {
        res = await fetchImpl(`${base}/api/auth/login`, JSON_POST(c));
      } catch {
        return {
          ok: false,
          kind: "unavailable",
          message: "The server did not answer. Check your connection and try again.",
        };
      }
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { user?: string | null };
        return { ok: true, user: body.user ?? null };
      }
      if (res.status === 401) {
        return {
          ok: false,
          kind: "invalid",
          message:
            "token" in c ? "That access token was not accepted." : "Wrong username or password.",
        };
      }
      if (res.status === 429) {
        const retryAfter = Math.max(1, Number(res.headers.get("retry-after")) || 30);
        return {
          ok: false,
          kind: "rate-limited",
          message: "Too many attempts.",
          retryAfter,
        };
      }
      if (res.status === 403) {
        return {
          ok: false,
          kind: "refused",
          message:
            (await errorText(res)) ??
            "The server refused the request. If you use a proxy, see VUURTOREN_ALLOWED_ORIGINS.",
        };
      }
      return {
        ok: false,
        kind: "unavailable",
        message: `The server could not sign you in right now (${res.status}). Try again in a moment.`,
      };
    },

    async signOut() {
      const res = await fetchImpl(`${base}/api/auth/logout`, JSON_POST({}));
      if (!res.ok) throw new Error((await errorText(res)) ?? "Could not sign out.");
    },

    async signOutAll() {
      const res = await fetchImpl(`${base}/api/auth/logout-all`, JSON_POST({}));
      if (!res.ok) throw new Error((await errorText(res)) ?? "Could not sign out everywhere.");
    },
  };
}
