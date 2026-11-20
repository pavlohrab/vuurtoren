/**
 * Per-device values in localStorage. Storage can be unavailable (private windows, blocked site
 * data): reads then return null and writes are dropped, so callers keep working for this visit.
 */
import type { KeyValueStorage } from "@app/ai";

/** The stored string, or null when missing or storage is unavailable. */
export function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // storage blocked: nothing remembered (expected)
    return null;
  }
}

/** Store a string; null removes the key. */
export function writeLocal(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage blocked: the value lasts for this visit only
  }
}

/** The stored JSON value, or undefined when missing, corrupt or storage is unavailable. */
export function readLocalJSON(key: string): unknown {
  const raw = readLocal(key);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // corrupt value: treated as missing
    return undefined;
  }
}

/** Store a JSON value; null removes the key. */
export function writeLocalJSON(key: string, value: unknown): void {
  writeLocal(key, value === null ? null : JSON.stringify(value));
}

/**
 * localStorage when it is writable, otherwise an in-memory store that lasts for this session
 * (services that need a Storage-like object: AI keys, a pending course import).
 */
export function deviceStorage(): KeyValueStorage {
  try {
    const probe = "vuurtoren.probe";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    // Expected in private windows / blocked storage: in-memory for this session.
    const m = new Map<string, string>();
    return {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => void m.set(k, v),
      removeItem: (k) => void m.delete(k),
    };
  }
}
