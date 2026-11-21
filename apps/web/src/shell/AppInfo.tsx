import { createContext, useContext } from "react";
import type { DataAdmin } from "@app/db";
import type { DesktopBridge } from "../desktop/bridge.js";

/** Desktop app: the database file in a visible folder. */
export interface DataFile {
  /** Full path of `vuurtoren.sqlite`. */
  path: string;
  /** Show the file in the system file manager. */
  reveal(): Promise<void>;
  /** Pick a folder, copy the file there and use it from now on; null when cancelled. */
  move(): Promise<string | null>;
}

/** What "Your data" in Settings needs: where data lives and how to back it up. */
export interface DataControls {
  /**
   * "desktop": the app's SQLite file on a computer; "phone": the app's SQLite file in its
   * private storage on a phone; "browser": SQLite in this browser (OPFS).
   */
  mode: "browser" | "desktop" | "phone";
  /** Browser mode: did `navigator.storage.persist()` succeed (null = not asked/unsupported). */
  persisted: boolean | null;
  /** Browser mode: false when the database is in memory only. */
  persistent: boolean;
  /** `window.isSecureContext`. */
  secure: boolean;
  admin: DataAdmin;
  /** Desktop mode: the file and what can be done with it. */
  file?: DataFile | undefined;
}

/** The app on a computer: the bundled language server. */
export interface DesktopLocal {
  nlp: DesktopBridge["nlp"];
}

/** Settings > Account on a page served by a Vuurtoren server. */
export interface AccountControls {
  /** False when the server runs without sign-in. */
  authEnabled: boolean;
  /** The signed-in username (null with the access token or auth off). */
  user: string | null;
  via: "session" | "token" | "open";
  signOut: () => Promise<void>;
  signOutAll: () => Promise<void>;
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
  /** Who is signed in on the Vuurtoren server this page comes from; absent elsewhere. */
  account?: AccountControls | undefined;
  /** The desktop app (absent everywhere else). */
  desktop?: DesktopLocal | undefined;
}

const AppInfoContext = createContext<AppInfo>({});

export const AppInfoProvider = AppInfoContext.Provider;

/** Access the app-level notice and demo flags. */
export function useAppInfo(): AppInfo {
  return useContext(AppInfoContext);
}
