/**
 * Sync tokens of a Vuurtoren server (server/api/src/auth/tokens.ts): what a device sends to
 * sync through the server and to use its language server. List, make (the token is returned
 * once) and revoke, on a page served by that server; its sign-in authorises the calls. A
 * pairing code (`pairCode`) lets a phone fetch a token of its own (Settings → Sync → Add a phone).
 */
/** A token as listed: never the secret itself. */
interface TokenInfo {
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt: number | null;
  /** The token may change the passphrase and recovery key. */
  vault?: boolean;
}

type FetchLike = typeof fetch;
const ambient: FetchLike = (...a) => globalThis.fetch(...a);
const HEADERS = { "content-type": "application/json", "x-vuurtoren": "1" };

async function ok<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new Error(body.error ?? `The server answered ${res.status}.`);
  return body;
}

export function createSyncTokenClient(fetchImpl: FetchLike = ambient) {
  const base = "/api/auth/sync-tokens";
  return {
    async list(): Promise<TokenInfo[]> {
      const res = await fetchImpl(base, { credentials: "same-origin", cache: "no-store" });
      return (await ok<{ tokens: TokenInfo[] }>(res)).tokens;
    },
    /** `vault`: the token may change the passphrase and recovery key. */
    async create(label: string, vault = false): Promise<TokenInfo & { token: string }> {
      const res = await fetchImpl(base, {
        method: "POST",
        credentials: "same-origin",
        headers: HEADERS,
        body: JSON.stringify({ label, vault }),
      });
      return ok(res);
    },
    /** A one-time pairing code; it works once, for `validMs`. */
    async pairCode(): Promise<{ code: string; expiresAt: number; validMs: number }> {
      const res = await fetchImpl("/api/sync/pair-code", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: HEADERS,
        body: "{}",
      });
      return ok(res);
    },
    async revoke(id: string): Promise<void> {
      const res = await fetchImpl(`${base}/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "same-origin",
        headers: HEADERS,
      });
      await ok(res);
    },
  };
}
