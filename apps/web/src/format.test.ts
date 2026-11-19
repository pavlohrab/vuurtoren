import { describe, expect, it } from "vitest";
import { relativeTime } from "./format.js";

describe("relativeTime", () => {
  const now = new Date(2026, 10, 19, 12, 0).getTime();
  it("says recent moments in words and older ones as a date", () => {
    expect(relativeTime(now - 10_000, now)).toBe("just now");
    expect(relativeTime(now - 5 * 60_000, now)).toMatch(/5 min/);
    expect(relativeTime(now - 3 * 3_600_000, now)).toMatch(/3 hours? ago/);
    expect(relativeTime(now - 30 * 86_400_000, now)).not.toMatch(/ago/);
  });
});
