/**
 * Cross-device freshness: in server mode the shell asks the server for a change
 * marker on focus, on becoming visible and every ~30 s while visible. A screen that must not
 * change under the learner's hands (a practice session mid-answer) holds the check; it runs
 * when the last hold is released.
 */
import { useEffect } from "react";

/** Seconds between checks while the page is visible. */
export const FRESHNESS_INTERVAL_MS = 30_000;

let holds = 0;
const releaseListeners = new Set<() => void>();

/** Defer refreshes until the returned function is called. */
export function holdFreshness(): () => void {
  holds++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds--;
    if (holds === 0) for (const l of releaseListeners) l();
  };
}

export function freshnessHeld(): boolean {
  return holds > 0;
}

/** Called when the last hold is released. */
export function onFreshnessReleased(listener: () => void): () => void {
  releaseListeners.add(listener);
  return () => releaseListeners.delete(listener);
}

/** Hold refreshes while the calling component is mounted (and `active`). */
export function useHoldFreshness(active = true): void {
  useEffect(() => (active ? holdFreshness() : undefined), [active]);
}
