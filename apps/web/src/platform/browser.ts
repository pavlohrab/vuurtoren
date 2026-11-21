/** A page in a browser: the server as sync place, the key in protected browser storage. */
import type { Device } from "./device.js";

export function browserDevice(): Device {
  return {
    kind: "browser",
    syncPlaces: ["server"],
    languageServer: "server",
    bridge: null,
    scanQr: null,
    cancelScan: null,
    links: null,
    haptic: () => undefined,
    notifications: false,
  };
}
