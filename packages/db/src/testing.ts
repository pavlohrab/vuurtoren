/** Helpers for tests ("@app/db/testing"): a sync store in memory and a light Argon2id cost. */
import type { Argon2Cost } from "./sync/crypto.js";
import type { SyncStore } from "./sync/store.js";

/** A light Argon2id cost, so tests that make or open a vault stay fast. */
export const LIGHT_ARGON2: Argon2Cost = { memoryKiB: 64, iterations: 1, parallelism: 1 };

/** A sync store in memory. */
export function memoryStore(label = "Memory"): SyncStore & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    label,
    files,
    async list(dir) {
      const prefix = dir ? `${dir.replace(/\/$/, "")}/` : "";
      const names = new Set<string>();
      for (const path of files.keys()) {
        if (!path.startsWith(prefix)) continue;
        names.add(path.slice(prefix.length).split("/")[0]!);
      }
      return [...names].sort();
    },
    async get(path) {
      const b = files.get(path);
      return b ? b.slice() : null;
    },
    async put(path, bytes) {
      files.set(path, bytes.slice());
    },
    async remove(path) {
      files.delete(path);
    },
  };
}
