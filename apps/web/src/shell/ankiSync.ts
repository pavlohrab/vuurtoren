/**
 * Reading the confirmed Anki decks into Kenning. One import at a time, shared by onboarding,
 * Settings and the automatic import when the app opens; the shell shows its progress.
 */
import type { QueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import type { AppServices, LearnerSummary } from "../services/types.js";

export interface AnkiSyncState {
  running: boolean;
  /** The latest progress message while running. */
  message: string | null;
  /** The error of the last import, until the next one starts. */
  error: string | null;
}

let state: AnkiSyncState = { running: false, message: null, error: null };
const listeners = new Set<() => void>();
let current: Promise<LearnerSummary> | null = null;

function update(next: Partial<AnkiSyncState>): void {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

/** The queries that change when the learner model does. */
const AFFECTED = ["learner", "texts", "words", "home", "practice", "languageProfile"];

/** Import the profile's decks now; joins an import that is already running. */
export function runAnkiSync(
  services: AppServices,
  qc: QueryClient,
  onProgress?: (msg: string) => void,
): Promise<LearnerSummary> {
  if (current) return current;
  update({ running: true, message: "Reading your Anki decks…", error: null });
  current = services
    .syncAnki((m) => {
      update({ message: m });
      onProgress?.(m);
    })
    .then(async (summary) => {
      update({ running: false, message: null });
      for (const k of AFFECTED) await qc.invalidateQueries({ queryKey: [k] });
      return summary;
    })
    .catch((e: unknown) => {
      update({ running: false, message: null, error: e instanceof Error ? e.message : String(e) });
      throw e;
    })
    .finally(() => {
      current = null;
    });
  return current;
}

export function clearAnkiSyncError(): void {
  update({ error: null });
}

export function useAnkiSync(): AnkiSyncState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** Import again when the last import is older than this. */
const STALE_MS = 6 * 60 * 60 * 1000;
/** Don't ask Anki more often than this when it is closed or the import failed. */
const RETRY_MS = 10 * 60 * 1000;
let lastTry = 0;

/** Should the app import by itself now? Exported for tests. */
export async function shouldAutoSync(services: AppServices, now = Date.now()): Promise<boolean> {
  const profile = await services.languageProfile();
  if (!profile || profile.sources.length === 0) return false;
  const summary = await services.learnerSummary();
  if (summary.lastSync !== null && now - summary.lastSync < STALE_MS) return false;
  const status = await services.ankiStatus();
  return status.state === "connected";
}

/**
 * Import the confirmed decks when the app opens or comes back to the front, if the last import
 * is missing or older than 6 hours and Anki is open. Never in demo mode.
 */
export function useAnkiAutoSync(services: AppServices, qc: QueryClient, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const tryNow = (): void => {
      if (state.running || Date.now() - lastTry < RETRY_MS) return;
      lastTry = Date.now();
      void shouldAutoSync(services)
        .then((go) => (go ? runAnkiSync(services, qc) : undefined))
        .catch(() => undefined);
    };
    tryNow();
    const onVisible = (): void => {
      if (document.visibilityState === "visible") tryNow();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [services, qc, enabled]);
}

/** Tests only: forget the shared state between test cases. */
export function resetAnkiSyncForTests(): void {
  state = { running: false, message: null, error: null };
  current = null;
  lastTry = 0;
}
