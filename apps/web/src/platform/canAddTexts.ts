/**
 * Can this device add a new text? A computer analyses texts itself; a phone needs its server (a
 * phone alone has no language server, A46). Without one, "Add text" is not offered on the phone:
 * its texts come from the computer through sync. A phone linked to its own computer doesn't add
 * texts either (SY6): you add them on the computer. Nor while its server can't be reached
 * (OF3): a text added then would wait without an analysis. Nor in the demo, which has no server.
 */
import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { degradedEntries, subscribeDegraded } from "../services/degraded.js";
import { useServices } from "../services/context.js";
import { currentDevice } from "./index.js";
import { DEMO_SITE } from "./demoSite.js";

export function useCanAddTexts(): boolean {
  const services = useServices();
  const phone = currentDevice().kind === "android";
  const sync = useQuery({
    queryKey: ["sync", "status"],
    queryFn: () => services.syncStatus(),
    enabled: phone,
  });
  const away = useSyncExternalStore(subscribeDegraded, () =>
    degradedEntries().some((e) => e.source === "nlp"),
  );
  // The demo has no language server to prepare a text: its stories only.
  if (DEMO_SITE) return false;
  if (!phone) return true;
  const place = sync.isSuccess ? sync.data.place : null;
  return place?.kind === "server" && !place.computer && !away;
}
