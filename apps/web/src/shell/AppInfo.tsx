import { createContext, useContext } from "react";

/** App-level facts the shell shows: storage problems and demo mode. */
export interface AppInfo {
  /** Persistent, quiet message shown at the top of the shell (e.g. data will not be saved). */
  notice?: string | undefined;
  /** True when mock demo data is shown on purpose (`?demo`). */
  demo?: boolean | undefined;
  /** Leave demo mode and reload with the user's own data. */
  onLeaveDemo?: (() => void) | undefined;
}

const AppInfoContext = createContext<AppInfo>({});

export const AppInfoProvider = AppInfoContext.Provider;

/** Access the app-level notice and demo flags. */
export function useAppInfo(): AppInfo {
  return useContext(AppInfoContext);
}
