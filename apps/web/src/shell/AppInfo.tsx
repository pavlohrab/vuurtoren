import { createContext, useContext } from "react";
import type { DataAdmin } from "@app/db";
import type { DesktopBridge } from "../desktop/bridge.js";

/** Desktop app, offline mode: the database file in a visible folder (docs/desktop.md). */
export interface DataFile {
  /** Full path of `kenning.sqlite`. */
  path: string;
  /** Show the file in the system file manager. */
  reveal(): Promise<void>;
  /** Pick a folder, copy the file there and use it from now on; null when cancelled. */
  move(): Promise<string | null>;
}

/** What "Your data" in Settings needs: where data lives and how to back it up. */
export interface DataControls {
  /** "desktop": the desktop app's SQLite file on this computer (offline mode). */
  mode: "server" | "browser" | "desktop";
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

/** Desktop app in offline mode: the bundled language server and the way to a server. */
export interface DesktopLocal {
  nlp: DesktopBridge["nlp"];
  /** Open the Connect screen ("Connect to a Kenning server"). */
  connectServer(): Promise<void>;
}

/** Settings > Account in server mode (ADR 0009). */
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
  /** Who is signed in; absent in browser and demo mode. */
  account?: AccountControls | undefined;
  /** Desktop app, offline mode (absent everywhere else). */
  desktop?: DesktopLocal | undefined;
}

const AppInfoContext = createContext<AppInfo>({});

export const AppInfoProvider = AppInfoContext.Provider;

/** Access the app-level notice and demo flags. */
export function useAppInfo(): AppInfo {
  return useContext(AppInfoContext);
}
