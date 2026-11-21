/**
 * The app on an Android phone: the data in the app's private storage (the bridge's database),
 * a Vuurtoren server as the only sync place, the sync key and the server's token in the Android
 * Keystore, the server's language server (`<server>/nlp` with the token, sent through the app so
 * no CORS setup is needed), the QR scanner and `vuurtoren://connect` links.
 */
import type { DesktopBridge } from "../desktop/bridge.js";
import type { Device } from "./device.js";

export function androidDevice(bridge: DesktopBridge): Device {
  return {
    kind: "android",
    syncPlaces: ["server"],
    languageServer: "server",
    bridge,
    scanQr: bridge.scanQr ?? null,
    links: bridge.links ?? null,
    haptic: () => {
      // The WebView passes short vibrations on where the app may vibrate.
      try {
        navigator.vibrate?.(8);
      } catch {
        // No motor: nothing to feel.
      }
    },
    notifications: false,
  };
}
