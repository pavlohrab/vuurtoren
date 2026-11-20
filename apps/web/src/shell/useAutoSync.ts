import { type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { desktopBridge } from "../desktop/bridge.js";
import { onDegradedRetry } from "../services/degraded.js";
import { freshnessHeld, onFreshnessReleased } from "../services/freshness.js";
import type { AutoSync } from "../services/syncTypes.js";
import type { AppServices } from "../services/types.js";

/** How often the timer pulls while the app is visible (the services decide what is due). */
const PULL_TICK_MS = 15_000;
/** How often the log's head is looked at for local changes to send. */
const LOCAL_TICK_MS = 5_000;

/**
 * Sync while the app is open: once at start, when the app comes back into view, every 15 s
 * while it is visible, and soon after a local change. When changes came in every query is
 * refetched (the services already dropped their caches). Deferred while a practice session
 * holds it. When the app is hidden, or the desktop window closes, the last changes go out.
 */
export function useAutoSync(services: AppServices, queryClient: QueryClient): void {
  // Retry (any mode): refetch everything; sources that still fail report themselves again.
  useEffect(
    () =>
      onDegradedRetry(() => {
        void queryClient.invalidateQueries();
      }),
    [queryClient],
  );
  // Leaving: hidden in a browser (the page's own pagehide waits for it before letting go of
  // the database, see main.tsx), or the desktop window closing (the app waits for it).
  useEffect(() => {
    if (!services.syncBeforeLeaving) return;
    const leave = () => services.syncBeforeLeaving!();
    const onHidden = () => {
      if (document.visibilityState === "hidden") void leave();
    };
    document.addEventListener("visibilitychange", onHidden);
    const offClose = desktopBridge()?.beforeClose?.(leave);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      offClose?.();
    };
  }, [services]);
  useEffect(() => {
    if (!services.autoSync) return;
    const autoSync = services.autoSync.bind(services);
    let pending: AutoSync | null = null;
    let running = false;
    const run = async (why: AutoSync): Promise<void> => {
      if (running || (why !== "start" && document.visibilityState === "hidden")) return;
      if (freshnessHeld()) {
        pending = pending === "start" ? pending : why;
        return;
      }
      running = true;
      pending = null;
      try {
        if (await autoSync(why)) await queryClient.invalidateQueries();
      } catch {
        // A failed sync shows in the degraded indicator and Settings → Sync.
      } finally {
        running = false;
      }
    };
    void run("start");
    const onFocus = () => void run("focus");
    const onVisible = () => {
      if (document.visibilityState === "visible") void run("focus");
    };
    addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    // Ticks while hidden do nothing (run returns early): pulling pauses with the page.
    const pull = setInterval(() => void run("timer"), PULL_TICK_MS);
    const local = setInterval(() => void run("local"), LOCAL_TICK_MS);
    const offRelease = onFreshnessReleased(() => {
      if (pending) void run(pending);
    });
    const offRetry = onDegradedRetry(() => void run("start"));
    return () => {
      removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(pull);
      clearInterval(local);
      offRelease();
      offRetry();
    };
  }, [services, queryClient]);
}
