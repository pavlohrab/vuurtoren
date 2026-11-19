/** Sync in demo mode: nothing leaves the page; a phone appears once sync is set up. */
import type { SyncPlace, SyncServices, SyncStatus } from "./syncTypes.js";

const LABEL: Record<SyncPlace["kind"], (p: SyncPlace) => string> = {
  server: (p) => `Kenning server · ${new URL((p as { url: string }).url).host}`,
  webdav: (p) => `WebDAV · ${new URL((p as { url: string }).url).host}`,
  github: (p) => `GitHub · ${(p as { repo: string }).repo}`,
  folder: (p) => `Folder · ${(p as { path: string }).path.split(/[\\/]/).filter(Boolean).at(-1)}`,
};

export function createMockSync(
  wait: () => Promise<void>,
  now: () => number = Date.now,
): SyncServices {
  let state: SyncStatus = {
    available: true,
    folders: false,
    place: null,
    deviceName: "This computer",
    last: null,
    error: null,
    devices: [],
  };
  const devices = (name: string, at: number) => [
    { id: "demo-self", name, at, self: true },
    { id: "demo-phone", name: "Phone", at: at - 3 * 3_600_000, self: false },
  ];
  return {
    async syncStatus() {
      await wait();
      return state;
    },
    async setUpSync(place, passphrase, deviceName, onProgress) {
      onProgress?.("Opening your synced data");
      await wait();
      if (passphrase.trim().length < 8)
        throw new Error("Use a passphrase of at least 8 characters.");
      const at = now();
      state = {
        ...state,
        place: { kind: place.kind, label: LABEL[place.kind](place) },
        deviceName: deviceName || state.deviceName,
        last: { at, sent: 12, received: 0 },
        error: null,
        devices: devices(deviceName || state.deviceName, at),
      };
      return { ...state, created: true };
    },
    async syncNow(onProgress) {
      onProgress?.("Sending 0 changes");
      await wait();
      if (!state.place) throw new Error("Sync is not set up on this device.");
      const at = now();
      state = {
        ...state,
        last: { at, sent: 0, received: 0 },
        devices: devices(state.deviceName, at),
      };
      return state;
    },
    async stopSync() {
      await wait();
      state = { ...state, place: null, last: null, devices: [] };
    },
    async pickSyncFolder() {
      return null;
    },
  };
}
