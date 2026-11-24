/**
 * Can this device add a new text? A computer analyses texts itself; a phone needs its server (a
 * phone alone has no language server, A46). Without one, "Add text" is not offered on the phone:
 * its texts come from the computer through sync.
 */
import { useQuery } from "@tanstack/react-query";
import { useServices } from "../services/context.js";
import { currentDevice } from "./index.js";

export function useCanAddTexts(): boolean {
  const services = useServices();
  const phone = currentDevice().kind === "android";
  const sync = useQuery({
    queryKey: ["sync", "status"],
    queryFn: () => services.syncStatus(),
    enabled: phone,
  });
  if (!phone) return true;
  return sync.isSuccess && sync.data.place?.kind === "server";
}
