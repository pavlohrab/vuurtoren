/**
 * What the live services need from the host: network access and per-device
 * key-value storage (settings secrets, AI keys, a pending course import). The browser build
 * uses `browserPlatform()`; a desktop shell or browser extension passes its own.
 */
import type { KeyValueStorage } from "@app/ai";
import { desktopBridge, withDesktopAnki } from "../desktop/bridge.js";
import { deviceStorage } from "../storage/local.js";

export interface Platform {
  fetch: typeof fetch;
  /** Per-device storage; never synced and never written to the event log. */
  storage: KeyValueStorage;
}

export function browserPlatform(): Platform {
  // Resolved per call, so a fetch installed later (tests, the degraded watcher) is used.
  const fetch: typeof globalThis.fetch = (input, init) => globalThis.fetch(input, init);
  // In the desktop app, AnkiConnect goes through the app (no webCorsOriginList setup).
  const bridge = desktopBridge();
  return {
    fetch: bridge ? withDesktopAnki(bridge, fetch) : fetch,
    storage: deviceStorage(),
  };
}
