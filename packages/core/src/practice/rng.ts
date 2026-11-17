/** Deterministic randomness for reproducible sessions and tests. */

/** A random source returning floats in [0, 1), like Math.random. */
export type Rng = () => number;

/**
 * mulberry32 PRNG: small, fast, good enough for shuffling exercises.
 * @param seed any integer; the same seed always yields the same sequence.
 */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle; returns a new array and leaves `items` untouched. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}

/** Uniformly pick one element; undefined for an empty array. */
export function pick<T>(items: readonly T[], rng: Rng): T | undefined {
  return items[Math.floor(rng() * items.length)];
}
