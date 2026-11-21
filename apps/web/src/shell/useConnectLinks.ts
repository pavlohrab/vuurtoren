import { type QueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { currentDevice } from "../platform/index.js";
import type { AppServices } from "../services/types.js";

/**
 * A `vuurtoren://connect` link (a phone opened it from the server's Add a phone, or the app
 * started with it) opens Settings → Sync, where Connect to your server uses it.
 */
export function useConnectLinks(services: AppServices, queryClient: QueryClient): void {
  const navigate = useNavigate();
  useEffect(() => {
    const links = currentDevice().links;
    if (!links) return;
    let live = true;
    const check = async () => {
      if (!(await services.pendingConnectLink()) || !live) return;
      await navigate({ to: "/settings", search: { section: "sync" } });
      await queryClient.invalidateQueries({ queryKey: ["sync"] });
    };
    void check();
    const off = links.onArrive(() => void check());
    return () => {
      live = false;
      off();
    };
  }, [services, queryClient, navigate]);
}
