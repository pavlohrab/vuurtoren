/** What a device can do (see `index.ts`). */
import type { DesktopBridge } from "../desktop/bridge.js";
import type { SyncPlace } from "../services/syncTypes.js";

export interface Device {
  kind: "browser" | "desktop" | "android";
  /** The sync places this device can use. */
  syncPlaces: readonly SyncPlace["kind"][];
  /**
   * Where analysis comes from: the language server bundled with the app, or a server's `/nlp`
   * (the page's own, or the sync server's with this device's sync token).
   */
  languageServer: "bundled" | "server";
  /**
   * The app's bridge for the database, sync requests and the key store (the system keychain,
   * the Android Keystore); null in a browser, where the key store is protected browser storage.
   */
  bridge: DesktopBridge | null;
  /** Read a QR code with the camera; null where the device has no scanner. */
  scanQr: (() => Promise<string | null>) | null;
  /** Stop a running scan; null where the device has no scanner. */
  cancelScan: (() => Promise<void>) | null;
  /** `vuurtoren://` links that opened the app; null where links do not reach it. */
  links: DesktopBridge["links"] | null;
  /** A light tick (a review answer); does nothing where the device cannot. */
  haptic(): void;
  /** Daily review reminders can be shown (not yet on any device). */
  notifications: boolean;
}
