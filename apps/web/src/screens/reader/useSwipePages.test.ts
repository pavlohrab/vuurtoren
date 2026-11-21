import { describe, expect, it } from "vitest";
import { swipeDirection } from "./useSwipePages.js";

describe("page swipes", () => {
  it("a clear sideways swipe turns the page; left is next", () => {
    expect(swipeDirection(-120, 10, 250)).toBe(1);
    expect(swipeDirection(120, -20, 250)).toBe(-1);
  });
  it("short, slow or mostly vertical moves are not swipes", () => {
    expect(swipeDirection(-40, 0, 200)).toBe(0);
    expect(swipeDirection(-120, 0, 900)).toBe(0);
    expect(swipeDirection(-100, 80, 200)).toBe(0);
  });
});
