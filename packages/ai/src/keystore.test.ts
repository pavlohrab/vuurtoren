import { describe, expect, it } from "vitest";
import {
  type KeyValueStorage,
  WrongPassphraseError,
  clearKey,
  keyStatus,
  loadKey,
  saveKey,
} from "./keystore.js";

function memStorage(): KeyValueStorage & { dump(): string } {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    dump: () => JSON.stringify([...m]),
  };
}

describe("keystore", () => {
  it("stores a plain key and clears it", async () => {
    const s = memStorage();
    await saveKey(s, "openai", "sk-abc");
    expect(keyStatus(s, "openai")).toEqual({ saved: true, encrypted: false });
    expect(await loadKey(s, "openai")).toBe("sk-abc");
    clearKey(s, "openai");
    expect(await loadKey(s, "openai")).toBeUndefined();
  });

  it("encrypts with a passphrase: ciphertext hides the key, wrong passphrase fails", async () => {
    const s = memStorage();
    await saveKey(s, "anthropic", "sk-ant-secret", "correct horse");
    expect(s.dump()).not.toContain("sk-ant-secret");
    expect(keyStatus(s, "anthropic")).toEqual({ saved: true, encrypted: true });
    expect(await loadKey(s, "anthropic", "correct horse")).toBe("sk-ant-secret");
    await expect(loadKey(s, "anthropic", "nope")).rejects.toBeInstanceOf(WrongPassphraseError);
    await expect(loadKey(s, "anthropic")).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it("keeps keys per provider", async () => {
    const s = memStorage();
    await saveKey(s, "a", "1");
    await saveKey(s, "b", "2");
    expect(await loadKey(s, "a")).toBe("1");
    expect(await loadKey(s, "b")).toBe("2");
  });
});
