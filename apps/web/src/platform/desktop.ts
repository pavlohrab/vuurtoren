/**
 * The app on a computer: every sync place (a server, a synced folder, WebDAV), the system
 * keychain, and the bundled language server.
 */
import type { DesktopBridge } from "../desktop/bridge.js";
import type { Device } from "./device.js";

export function desktopDevice(bridge: DesktopBridge): Device {
  return {
    kind: "desktop",
    syncPlaces: ["server", "folder", "webdav"],
    languageServer: "bundled",
    bridge,
    scanQr: null,
    cancelScan: null,
    links: null,
    notifications: false,
  };
}
