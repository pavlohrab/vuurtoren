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

/**
 * Whether the app runs on an Android phone. The bridge's `os` says so; the user agent is the
 * fallback (an older bridge without `os`): the Android System WebView always puts "Android" in
 * it, and inside Tauri `__TAURI_INTERNALS__` is there too, so a desktop browser that fakes a
 * phone's user agent is not taken for the app.
 */
export function isAndroidApp(
  bridge: { readonly os?: string | undefined } | null,
  env: { tauri: boolean; userAgent: string } = runtimeEnv(),
): boolean {
  if (bridge?.os === "android") return true;
  return env.tauri && /\bAndroid\b/i.test(env.userAgent);
}

function runtimeEnv(): { tauri: boolean; userAgent: string } {
  if (typeof window === "undefined") return { tauri: false, userAgent: "" };
  return {
    tauri: "__TAURI_INTERNALS__" in window,
    userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
  };
}

/** This device, from what the page was given at start. */
export function currentDevice(): Device {
  const bridge = desktopBridge();
  if (!bridge?.home) return browserDevice();
  return isAndroidApp(bridge) ? androidDevice(bridge) : desktopDevice(bridge);
}
