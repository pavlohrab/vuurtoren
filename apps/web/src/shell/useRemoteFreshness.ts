import { type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  DEGRADED_MESSAGES,
  clearDegraded,
  onDegradedRetry,
  reportDegraded,
} from "../services/degraded.js";
import {
  FRESHNESS_INTERVAL_MS,
  freshnessHeld,
  onFreshnessReleased,
} from "../services/freshness.js";
import type { AppServices } from "../services/types.js";

/**
 * Cross-device freshness: on focus, on becoming visible and every ~30 s while visible, ask
 * whether another device changed the data (server mode: the server; a device with its own data:
 * a sync when one is due); if so every query is refetched (the services already dropped their
 * caches). Deferred while a practice session holds it. An unreachable server or sync place shows
 * in the degraded indicator; Retry checks again. When the app is hidden or closed, a device that
 * syncs sends its last changes.
 */
export function useRemoteFreshness(services: AppServices, queryClient: QueryClient): void {
  // Retry (any mode): refetch everything; sources that still fail report themselves again.
  useEffect(
    () =>
      onDegradedRetry(() => {
        void queryClient.invalidateQueries();
      }),
    [queryClient],
  );
  // Leaving (hidden, or closing): send this device's last changes now rather than at the next
  // start. Best effort: the page may be gone before it finishes.
  useEffect(() => {
    if (!services.syncBeforeLeaving) return;
    const leave = () => void services.syncBeforeLeaving!();
    const onHidden = () => {
      if (document.visibilityState === "hidden") leave();
    };
    document.addEventListener("visibilitychange", onHidden);
    addEventListener("pagehide", leave);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      removeEventListener("pagehide", leave);
    };
  }, [services]);
  useEffect(() => {
    if (!services.checkRemoteChanges) return;
    const check = () => services.checkRemoteChanges!();
    let pending = false;
    let running = false;
    const run = async (): Promise<void> => {
      if (document.visibilityState === "hidden" || running) return;
      if (freshnessHeld()) {
        pending = true;
        return;
      }
      running = true;
      pending = false;
      try {
        const changed = await check();
        clearDegraded("storage");
        if (changed) await queryClient.invalidateQueries();
      } catch (e) {
        // 401: the session ended; the sign-in watch takes over (not a degraded mode).
        if ((e as { status?: unknown }).status !== 401) {
          reportDegraded("storage", DEGRADED_MESSAGES.storage, e);
        }
      } finally {
        running = false;
      }
    };
    const onFocus = () => void run();
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    // Ticks while hidden do nothing (run returns early): polling pauses with the page.
    const timer = setInterval(() => void run(), FRESHNESS_INTERVAL_MS);
    const offRelease = onFreshnessReleased(() => {
      if (pending) void run();
    });
    const offRetry = onDegradedRetry(() => void run());
    return () => {
      removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
      offRelease();
      offRetry();
    };
  }, [services, queryClient]);
}
