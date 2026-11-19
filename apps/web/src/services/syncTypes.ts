/** Contract of sync: your data on every device, through a place you choose, encrypted. */
import type { SyncDevice } from "@app/db";

export type { SyncDevice };

/** Where synced files live, with what this device needs to reach it. */
export type SyncPlace =
  | { kind: "server"; url: string; token: string }
  | { kind: "webdav"; url: string; user: string; password: string }
  | { kind: "github"; repo: string; token: string; branch?: string }
  | { kind: "folder"; path: string };

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
   * Connect this device to a place: open the data there with the passphrase, or start new data
   * there when it has none. Then sync once. `created` tells which happened.
   */
  setUpSync(
    place: SyncPlace,
    passphrase: string,
    deviceName: string,
    onProgress?: (msg: string) => void,
  ): Promise<SyncStatus & { created: boolean }>;
  /** Sync now (sync also runs by itself while the app is open). */
  syncNow(onProgress?: (msg: string) => void): Promise<SyncStatus>;
  /** Stop syncing on this device; the data here and in the place stay. */
  stopSync(): Promise<void>;
  /** Choose a folder (desktop app); null when cancelled or not available. */
  pickSyncFolder(): Promise<string | null>;
}
