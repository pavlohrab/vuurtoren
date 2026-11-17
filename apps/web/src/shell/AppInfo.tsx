import { createContext, useContext } from "react";
import type { DataAdmin } from "@app/db";

/** What "Your data" in Settings needs: where data lives and how to back it up. */
export interface DataControls {
  mode: "server" | "browser";
  /** Browser mode: did `navigator.storage.persist()` succeed (null = not asked/unsupported). */
  persisted: boolean | null;
  /** Browser mode: false when the database is in memory only. */
  persistent: boolean;
  /** `window.isSecureContext`. */
  secure: boolean;
  admin: DataAdmin;
}

/** App-level facts the shell shows: storage problems and demo mode. */
export interface AppInfo {
  /** Persistent, quiet message shown at the top of the shell (e.g. data will not be saved). */
  notice?: string | undefined;
  /** True when mock demo data is shown on purpose (`?demo`). */
  demo?: boolean | undefined;
  /** Leave demo mode and reload with the user's own data. */
  onLeaveDemo?: (() => void) | undefined;
  /** Backup/restore and storage facts; absent in demo mode. */
  data?: DataControls | undefined;
}

const AppInfoContext = createContext<AppInfo>({});

export const AppInfoProvider = AppInfoContext.Provider;

/** Access the app-level notice and demo flags. */
export function useAppInfo(): AppInfo {
  return useContext(AppInfoContext);
}
