import { describe, expect, it, vi } from "vitest";
import type { DesktopSync } from "../desktop/bridge.js";
import {
  type WrappedKey,
  type WrappedKeyRecords,
  forgetSyncKey,
  loadSyncKey,
  saveSyncKey,
} from "./keyStore.js";

/** IndexedDB stand-in: keeps a structured clone, as IndexedDB does. */
function memoryRecords(): WrappedKeyRecords & { record: () => WrappedKey | undefined } {
  let record: WrappedKey | undefined;
  return {
    record: () => record,
    get: async () => (record ? structuredClone(record) : undefined),
    put: async (r) => void (record = structuredClone(r)),
    delete: async () => void (record = undefined),
  };
}

const key = () => crypto.getRandomValues(new Uint8Array(64));

describe("sync key store", () => {
  it("keeps the key in the browser wrapped by a key that cannot be exported", async () => {
    const records = memoryRecords();
    expect(await loadSyncKey({ records })).toBeNull();
    const raw = key();
    expect(await saveSyncKey(raw, { records })).toBe("browser");
    expect(await loadSyncKey({ records })).toEqual(raw);

    const stored = records.record()!;
    expect(stored.wrap.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", stored.wrap)).rejects.toThrow();
    // The stored bytes are not the key.
    expect(new Uint8Array(stored.sealed).slice(0, 64)).not.toEqual(raw);

    // Saving again replaces it, with a new wrapping key.
    const next = key();
    await saveSyncKey(next, { records });
    expect(records.record()!.wrap).not.toBe(stored.wrap);
    expect(await loadSyncKey({ records })).toEqual(next);

    await forgetSyncKey({ records });
    expect(await loadSyncKey({ records })).toBeNull();
  });

  it("treats a damaged record as no key", async () => {
    const records = memoryRecords();
    await saveSyncKey(key(), { records });
    const r = records.record()!;
    new Uint8Array(r.sealed)[0]! ^= 1;
    expect(await loadSyncKey({ records })).toBeNull();
  });

  it("uses the desktop app's keychain when there is one", async () => {
    let kept: string | null = null;
    const desktop = {
      saveKey: vi.fn(async (k: string) => {
        kept = k;
        return "keychain" as const;
      }),
      loadKey: vi.fn(async () => kept),
      forgetKey: vi.fn(async () => void (kept = null)),
    } as unknown as DesktopSync;
    const records = memoryRecords();
    const raw = key();
    expect(await saveSyncKey(raw, { desktop, records })).toBe("keychain");
    expect(records.record()).toBeUndefined();
    expect(kept).toHaveLength(88);
    expect(await loadSyncKey({ desktop, records })).toEqual(raw);
    await forgetSyncKey({ desktop, records });
    expect(await loadSyncKey({ desktop, records })).toBeNull();
  });
});
