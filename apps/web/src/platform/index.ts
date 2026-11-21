/**
 * The platform layer: what differs per device, behind one interface. The services and the
 * shell ask `currentDevice()` what this device can do, and the UI hides what it lacks (no
 * folder or WebDAV places and no bundled language server on a phone, no camera scanner on a
 * computer).
 *
 * - `browser.ts`: a page in a browser (data in OPFS, the page's or the sync server's `/nlp`);
 * - `desktop.ts`: the app on a computer (keychain, bundled language server, every sync place);
 * - `android.ts`: the app on an Android phone (Android Keystore, the server's language server,
 *   the server as the only sync place, the QR scanner and `vuurtoren://` links).
 */
import { desktopBridge } from "../desktop/bridge.js";
import { androidDevice } from "./android.js";
import { browserDevice } from "./browser.js";
import { desktopDevice } from "./desktop.js";
import type { Device } from "./device.js";

export type { Device } from "./device.js";

/** This device, from what the page was given at start. */
export function currentDevice(): Device {
  const bridge = desktopBridge();
  if (!bridge?.home) return browserDevice();
  return bridge.os === "android" ? androidDevice(bridge) : desktopDevice(bridge);
}
