/** Contract of sync: your data on every device, through a place you choose, encrypted. */
import type { SyncDevice } from "@app/db";

/** Where synced files live, with what this device needs to reach it. */
export type SyncPlace =
  | { kind: "server"; url: string; token: string }
  | { kind: "webdav"; url: string; user: string; password: string }
  | { kind: "github"; repo: string; token: string; branch?: string }
  | { kind: "folder"; path: string };

/**
 * How a device connects to a place: `start` makes new sync data there (the first device; the
 * place must hold none), `join` opens the data another device started (never makes any).
 */
export type SetUpHow = "start" | "join";

export interface SyncStatus {
  /** Sync can run here: a device with its own data (not a page of a Kenning server). */
  available: boolean;
  /** A folder you already sync can be chosen (the desktop app). */
  folders: boolean;
  /** The place in use, or null when sync is off. */
  place: { kind: SyncPlace["kind"]; label: string } | null;
  /** This device's name, shown on the others. */
  deviceName: string;
  /** The last sync that finished. */
  last: { at: number; sent: number; received: number } | null;
  /** Why the last attempt did not finish, or null. */
  error: string | null;
  /** Every device that syncs to the place (after a sync). */
  devices: SyncDevice[];
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
   * The app is being hidden or closed: send this device's last changes now, if there are any
   * (best effort; never throws). Absent where nothing syncs.
   */
  syncBeforeLeaving?(): Promise<void>;
}
