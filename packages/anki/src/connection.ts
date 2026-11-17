/**
 * Anki onboarding: tell the user's situation apart and ask Anki for permission.
 *
 * AnkiConnect only answers browsers from origins in its `webCorsOriginList`. For any other
 * origin it replies 403 without a matching `Access-Control-Allow-Origin`, so the browser hides
 * the reply and `fetch` throws, exactly as when Anki is not running. To tell the two apart we
 * send a harmless `no-cors` GET: an opaque response still resolves when something listens.
 *
 * `requestPermission` (legacy API, allowed from any origin) shows an "allow this site?" dialog
 * inside Anki, so it is only ever called on an explicit user action, never while probing.
 * See docs/research/02-anki-integration.md.
 */
import { AnkiConnectClient, AnkiConnectError, type AnkiConnectOptions } from "./client.js";

/** Where the Anki connection stands. */
export type AnkiConnectionState =
  /** Everything works. */
  | { state: "connected"; version: number }
  /** Nothing answers: Anki is closed or the AnkiConnect add-on is not installed. */
  | { state: "not-running" }
  /** AnkiConnect answers but does not allow this site (webCorsOriginList). */
  | { state: "not-allowed" }
  /** This site is allowed but AnkiConnect wants an API key we did not (correctly) send. */
  | { state: "needs-key"; version: number }
  /** Anki did not answer in time (probably a dialog is open). */
  | { state: "busy" };

/** Result of asking Anki to allow this site. */
export type AnkiPermissionOutcome =
  | { outcome: "granted"; requireApiKey: boolean; version: number }
  | { outcome: "denied" }
  | { outcome: "not-running" }
  | { outcome: "busy" };

/** How long to wait for the user to answer the dialog in Anki. */
const PERMISSION_TIMEOUT_MS = 120_000;

/** True if something answers HTTP at the AnkiConnect address (CORS-blocked answers count). */
async function isReachable(opts: AnkiConnectOptions): Promise<boolean> {
  const f = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const url = (opts.url ?? "http://127.0.0.1:8765").replace(/\/$/, "");
  try {
    await f(url, { method: "GET", mode: "no-cors", signal: AbortSignal.timeout(5_000) });
    return true;
  } catch {
    return false;
  }
}

/**
 * Work out the connection state without ever triggering a dialog in Anki.
 * Never throws.
 */
export async function probeAnki(opts: AnkiConnectOptions = {}): Promise<AnkiConnectionState> {
  const client = new AnkiConnectClient(opts);
  try {
    const version = await client.version();
    try {
      // `version` needs no key; any other action does, so this reveals a missing/wrong key.
      await client.deckNames();
    } catch (e) {
      if (e instanceof AnkiConnectError && e.kind === "api" && /api key/i.test(e.message))
        return { state: "needs-key", version };
      throw e;
    }
    return { state: "connected", version };
  } catch (e) {
    if (!(e instanceof AnkiConnectError)) return { state: "not-running" };
    if (e.kind === "timeout") return { state: "busy" };
    if (e.kind === "forbidden") return { state: "not-allowed" };
    if (e.kind === "network")
      return (await isReachable(opts)) ? { state: "not-allowed" } : { state: "not-running" };
    // Anything else (odd reply, not JSON): something answers but is not usable as AnkiConnect.
    return { state: "not-running" };
  }
}

/**
 * Ask Anki to allow this site. Shows a dialog in Anki; the user must click Yes. On success the
 * origin is added to AnkiConnect's webCorsOriginList. Call only from a user action.
 */
export async function requestAnkiPermission(
  opts: AnkiConnectOptions = {},
): Promise<AnkiPermissionOutcome> {
  const client = new AnkiConnectClient({ ...opts, timeoutMs: PERMISSION_TIMEOUT_MS });
  try {
    const r = await client.invoke<{
      permission: "granted" | "denied";
      requireApiKey?: boolean;
      version?: number;
    }>("requestPermission");
    if (r.permission !== "granted") return { outcome: "denied" };
    return { outcome: "granted", requireApiKey: !!r.requireApiKey, version: r.version ?? 6 };
  } catch (e) {
    if (e instanceof AnkiConnectError && e.kind === "timeout") return { outcome: "busy" };
    if (e instanceof AnkiConnectError && e.kind === "forbidden") return { outcome: "denied" };
    return { outcome: "not-running" };
  }
}

/** The line to paste into AnkiConnect's config so `origin` is allowed. */
export function corsConfigLine(origin: string): string {
  return `"webCorsOriginList": ["http://localhost", ${JSON.stringify(origin)}]`;
}
