/**
 * What the live services need from the host (review A20): network access and per-device
 * key-value storage (settings secrets, AI keys, a pending course import). The browser build
 * uses `browserPlatform()`; a desktop shell or browser extension passes its own.
 */
import type { KeyValueStorage } from "@app/ai";
import { deviceStorage } from "../storage/local.js";

export interface Platform {
  fetch: typeof fetch;
  /** Per-device storage; never synced and never written to the event log. */
  storage: KeyValueStorage;
}

export function browserPlatform(): Platform {
  return {
    // Resolved per call, so a fetch installed later (tests, the degraded watcher) is used.
    fetch: (input, init) => globalThis.fetch(input, init),
    storage: deviceStorage(),
  };
}
