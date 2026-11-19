/**
 * Native mode: tune the FSRS parameters by itself once per session, when 30 days or 500 new
 * answers have passed since the last tuning. Runs in a worker; failures stay quiet (Settings
 * shows the state and offers "Optimise now").
 */
import type { QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { AppServices } from "../services/types.js";

let started = false;

export function useAutoTune(services: AppServices, qc: QueryClient, enabled: boolean): void {
  useEffect(() => {
    if (!enabled || started) return;
    started = true;
    void services
      .autoTune()
      .then((r) => (r ? qc.invalidateQueries({ queryKey: ["review"] }) : undefined))
      .catch(() => undefined);
  }, [services, qc, enabled]);
}

