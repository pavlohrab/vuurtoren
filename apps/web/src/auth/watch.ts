/**
 * Notice when the session ends while the app is open: any same-origin `/api/` or `/nlp/`
 * answer with status 401 (expired cookie, "sign out all devices" elsewhere, a changed
 * password) tells the listeners, which show the sign-in screen over the app.
 *
 * It wraps `fetch` once, before the services are created (the NLP client binds `fetch` at
 * construction). Other origins (AnkiConnect, AI providers) and the sign-in endpoints
 * themselves are passed through untouched.
 */

type Listener = () => void;

const listeners = new Set<Listener>();
let installed = false;

/** Is this request one whose 401 means "signed out"? */
export function watchesUrl(input: RequestInfo | URL, origin: string): boolean {
  let url: URL;
  try {
    const raw = input instanceof Request ? input.url : String(input);
    url = new URL(raw, origin);
  } catch {
    // not a URL we can parse: not an /api or /nlp request (expected)
    return false;
  }
  if (url.origin !== origin) return false;
  const p = url.pathname;
  if (p.startsWith("/api/auth/") || p === "/api/health") return false;
  return p.startsWith("/api/") || p.startsWith("/nlp/");
}

/**
 * Wrap `target.fetch` (default: the global one). Idempotent for the global object.
 * @returns a function that restores the original fetch
 */
export function installFetchWatch(
  target: { fetch: typeof fetch } = globalThis,
  origin: string = globalThis.location?.origin ?? "http://localhost",
): () => void {
  if (target === globalThis && installed) return () => undefined;
  const original = target.fetch;
  target.fetch = async (input, init) => {
    const res = await original.call(globalThis, input, init);
    if (res.status === 401 && watchesUrl(input, origin)) {
      for (const fn of [...listeners]) fn();
    }
    return res;
  };
  if (target === globalThis) installed = true;
  return () => {
    target.fetch = original;
    if (target === globalThis) installed = false;
  };
}

/** Subscribe to "the session ended"; returns the unsubscribe function. */
export function onUnauthorized(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Event the app listens to after a successful re-sign-in (refetches its data). */
export const SIGNED_IN_EVENT = "kenning:signed-in";
