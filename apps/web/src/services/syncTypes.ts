/** Contract of sync: your data on every device, through a place you choose, encrypted. */
import type { SyncDevice, SyncProblem } from "@app/db";

/** Where synced files live, with what this device needs to reach it. */
export type SyncPlace =
  /**
   * A Vuurtoren server's `/api/sync` with a sync token. On the page of that same server the
   * token may be empty: the page makes one for itself with its sign-in.
   */
  | { kind: "server"; url: string; token: string }
  /** WebDAV (the desktop app). */
  | { kind: "webdav"; url: string; user: string; password: string }
  /** A folder you already sync (the desktop app). */
  | { kind: "folder"; path: string };

/**
 * How a device connects to a place: `start` makes new sync data there (the first device; the
 * place must hold none), `join` opens the data another device started (never makes any).
 */
export type SetUpHow = "start" | "join";

/** Why sync runs by itself: the app opened, it came back into view, the timer, a local change. */
export type AutoSync = "start" | "focus" | "timer" | "local";

export interface SyncStatus {
  /** The desktop app: a folder and WebDAV can be chosen. */
  desktop: boolean;
  /** The address of the Vuurtoren server this page comes from (it can be the place), or null. */
  thisServer: string | null;
  /** The place in use, or null when sync is off. */
  place: { kind: SyncPlace["kind"]; label: string } | null;
  /** This device's name, shown on the others. */
  deviceName: string;
  /** The last sync that finished. */
  last: { at: number; sent: number; received: number } | null;
  /** Why the last attempt did not finish, or null. */
  error: string | null;
  /** This device does not have its sync key: the passphrase or recovery key brings it back. */
  needsKey: boolean;
  /** Every device that syncs to the place (after a sync). */
  devices: SyncDevice[];
  /** Files and changes sync left out or still waits for. */
  problems: SyncProblem[];
}

export interface SyncServices {
  syncStatus(): Promise<SyncStatus>;
  /**
   * Connect this device to a place (see `SetUpHow`), then sync once. Once the place is open,
   * sync stays set up even when that first sync does not finish: `error` says why, and a new
   * `recoveryKey` (start only; shown once) is returned all the same.
   */
  setUpSync(
    place: SyncPlace,
    how: SetUpHow,
    passphrase: string,
    deviceName: string,
    onProgress?: (msg: string) => void,
  ): Promise<SyncStatus & { created: boolean; recoveryKey: string | null }>;
  /** Sync now (sync also runs by itself while the app is open). */
  syncNow(onProgress?: (msg: string) => void): Promise<SyncStatus>;
  /** Bring back this device's sync key with the passphrase or the recovery key, then sync. */
  unlockSync(secret: string): Promise<SyncStatus>;
  /**
   * A new passphrase for the synced data, after `current` (the passphrase or the recovery key)
   * opened it. No file changes; other devices keep syncing.
   */
  changeSyncPassphrase(current: string, next: string): Promise<void>;
  /** A new recovery key (shown once; the old one stops working), after `current` opened the data. */
  newSyncRecoveryKey(current: string): Promise<string>;
  /** Stop syncing on this device; the data here and in the place stay. */
  stopSync(): Promise<void>;
  /** Choose a folder (desktop app); null when cancelled or not available. */
  pickSyncFolder(): Promise<string | null>;
  /**
   * The app is being hidden or closed: send what this device has not sent yet, if anything
   * (best effort; never throws). Absent where nothing syncs.
   */
  syncBeforeLeaving?(): Promise<void>;
}
