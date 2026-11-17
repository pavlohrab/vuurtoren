import type { ServerHealth } from "@app/db/http";

/** Where the user's data lives for this page load. */
export type StorageMode =
  { kind: "demo" } | { kind: "server"; health: ServerHealth } | { kind: "browser" };

/**
 * Pick the storage mode. Demo wins when asked for; otherwise a Kenning API that answers
 * on the same origin means server mode (one SQLite file on the server); else this browser.
 *
 * @param health the answer of `GET /api/health`, or null when nothing (Kenning) answered
 */
export function selectStorageMode(input: {
  demo: boolean;
  health: ServerHealth | null;
}): StorageMode {
  if (input.demo) return { kind: "demo" };
  return input.health ? { kind: "server", health: input.health } : { kind: "browser" };
}

const TOKEN_KEY = "kenning-token";

/** The access token remembered by the login prompt (null when none or storage is blocked). */
export function loadToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Remember (or with null forget) the access token. */
export function saveToken(token: string | null): void {
  try {
    if (token === null) localStorage.removeItem(TOKEN_KEY);
    else localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* private mode: the user will be asked again next time */
  }
}
