import { describe, expect, it } from "vitest";
import { fold } from "./paperFold.js";

describe("the paper fold", () => {
  it("cuts the corner off and mirrors it over the fold", () => {
    // A 100 × 200 page, its bottom-right corner pulled to the middle of the bottom edge.
    const f = fold(100, 200, 0, [100, 200], [50, 200]);
    // The fold is the vertical line x = 75: the page left of it stays.
    expect(f.keep.map((q) => q.map(Math.round))).toEqual([
      [0, 0],
      [75, 0],
      [75, 200],
      [0, 200],
    ]);
    // The strip 75…100 lands mirrored on 50…75.
    const xs = f.flap.map((q) => Math.round(q[0])).sort((a, b) => a - b);
    expect(xs[0]).toBe(50);
    expect(xs[xs.length - 1]).toBe(75);
  });

  it("keeps the whole page before the finger moves, and nothing once it's past the spine", () => {
    expect(fold(100, 200, 0, [100, 200], [99.9, 200]).keep.length).toBeGreaterThan(3);
    expect(fold(100, 200, 0, [100, 200], [-110, 200]).keep.length).toBe(0);
  });
});
