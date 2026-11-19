/**
 * One shared "degraded" signal: optional parts of the app (language server, Anki,
 * AI provider, translation, the storage server) report here when they stop answering, and
 * clear their entry when they answer again. The shell shows a quiet indicator in the top bar;
 * nothing here raises toasts. Real errors of a user action still go to the screen's
 * ErrorNotice; this is only for "works, but with less".
 */

export type DegradedSource = "nlp" | "anki" | "ai" | "translate" | "storage";

export interface DegradedEntry {
  source: DegradedSource;
  /** Plain-language summary, e.g. "Language server unreachable — some features limited". */
  message: string;
  /** Technical detail of the last failure (shown in the details popover). */
  detail?: string;
  /** When this source first failed (ms since epoch); kept while it keeps failing. */
  since: number;
}

type Listener = () => void;

let entries: readonly DegradedEntry[] = [];
const listeners = new Set<Listener>();
const retryListeners = new Set<Listener>();

function emit(next: readonly DegradedEntry[]): void {
  entries = next;
  for (const l of listeners) l();
}

const detailOf = (e: unknown): string | undefined =>
  e === undefined ? undefined : e instanceof Error ? e.message : String(e);

/** Report that `source` works in a degraded way; repeated reports keep the first `since`. */
export function reportDegraded(
  source: DegradedSource,
  message: string,
  cause?: unknown,
  now: number = Date.now(),
): void {
  const prev = entries.find((e) => e.source === source);
  const detail = detailOf(cause);
  if (prev && prev.message === message && prev.detail === detail) return;
  const entry: DegradedEntry = {
    source,
    message,
    since: prev?.since ?? now,
    ...(detail ? { detail } : {}),
  };
  emit([...entries.filter((e) => e.source !== source), entry]);
}

/** `source` answered again. */
export function clearDegraded(source: DegradedSource): void {
  if (entries.some((e) => e.source === source)) {
    emit(entries.filter((e) => e.source !== source));
  }
}

/** Current entries (a stable array until the next change; usable with useSyncExternalStore). */
export function degradedEntries(): readonly DegradedEntry[] {
  return entries;
}

export function subscribeDegraded(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * "Retry" in the shell: forget every entry and tell listeners (the shell refetches its
 * queries); sources that still fail report themselves again.
 */
export function retryDegraded(): void {
  emit([]);
  for (const l of retryListeners) l();
}

export function onDegradedRetry(listener: Listener): () => void {
  retryListeners.add(listener);
  return () => retryListeners.delete(listener);
}

/** Tests: start from a clean slate. */
export function resetDegraded(): void {
  emit([]);
}

/** Messages of the shared sources (one wording everywhere). */
export const DEGRADED_MESSAGES = {
  nlp: "Language server unreachable — some features limited",
  translate: "Translations unavailable — meanings and sentence translations may be missing",
  anki: "Anki not reachable — card status and adding cards unavailable",
  ai: "AI provider not answering — AI features limited",
  storage: "Server unreachable — changes may not be saved",
} as const satisfies Record<DegradedSource, string>;

/**
 * Wrap a client so that every async method reports to the degraded signal: a resolved call
 * clears `source`, a rejection for which `isOutage` holds reports it. The rejection still
 * reaches the caller unchanged (it decides whether it is a real error for the user).
 */
export function watchClient<T extends object>(
  client: T,
  source: DegradedSource,
  isOutage: (e: unknown) => boolean,
  message: string = DEGRADED_MESSAGES[source],
): T {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const out: unknown = (value as (...a: unknown[]) => unknown).apply(target, args);
        if (out instanceof Promise) {
          out.then(
            () => clearDegraded(source),
            (e: unknown) => {
              if (isOutage(e)) reportDegraded(source, message, e);
            },
          );
        }
        return out;
      };
    },
  });
}
