import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { AppServices } from "./types.js";

const ServicesContext = createContext<AppServices | null>(null);

/** Provides the services implementation (mock or real) to the whole app. */
export function ServicesProvider({
  services,
  children,
}: {
  services: AppServices;
  children: ReactNode;
}) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

/** Access the services. Throws outside a ServicesProvider. */
export function useServices(): AppServices {
  const s = useContext(ServicesContext);
  if (!s) throw new Error("useServices must be used inside <ServicesProvider>");
  return s;
}
