/**
 * Browser side of sign-in (server/api/src/auth, ADR 0009). The session lives in an HttpOnly
 * cookie the page cannot read; this module only calls the endpoints and interprets answers.
 */

export type AuthMethod = "password" | "token";

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
  headers: { "content-type": "application/json", "x-kenning": "1" },
  body: JSON.stringify(body),
});

async function errorText(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : null;
  } catch {
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
            "The server refused the request. If you use a proxy, see KENNING_ALLOWED_ORIGINS.",
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
