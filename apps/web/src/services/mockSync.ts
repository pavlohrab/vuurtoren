/** Sync in demo mode: nothing leaves the page; a phone appears once sync is set up. */
import { placeLabel } from "../sync/labels.js";
import type { SyncServices, SyncStatus } from "./syncTypes.js";

export function createMockSync(
  wait: () => Promise<void>,
  now: () => number = Date.now,
): SyncServices {
  let state: SyncStatus = {
    available: true,
    folders: false,
    place: null,
    deviceName: "This device",
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
    async setUpSync(place, how, passphrase, deviceName, onProgress) {
      onProgress?.(how === "join" ? "Opening your synced data" : "Starting your sync data");
      await wait();
      if (passphrase.trim().length < 8)
        throw new Error("Use a passphrase of at least 8 characters.");
      const at = now();
      state = {
        ...state,
        place: { kind: place.kind, label: placeLabel(place) },
        deviceName: deviceName || state.deviceName,
        last: { at, sent: 12, received: how === "join" ? 40 : 0 },
        error: null,
        devices: devices(deviceName || state.deviceName, at),
      };
      return how === "join"
        ? { ...state, created: false, recoveryKey: null }
        : { ...state, created: true, recoveryKey: "K7QM-2XRA-9F4D-HV3C-T8NW-5BJP-6GZE-1YKS" };
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
    async changeSyncPassphrase(current, next) {
      await wait();
      if (current.trim().length < 8)
        throw new Error("This passphrase does not open your synced data.");
      if (next.trim().length < 8) throw new Error("Use a passphrase of at least 8 characters.");
    },
    async newSyncRecoveryKey(current) {
      await wait();
      if (current.trim().length < 8)
        throw new Error("This passphrase does not open your synced data.");
      return "P3VD-8KQA-2MXN-7HTF-4WJC-9ZBE-6RGS-1YQK";
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
