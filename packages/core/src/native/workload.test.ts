import { describe, expect, it } from "vitest";
import { balanceInterval, dailyLoad, intervalAt, mondayFirst, NORMAL_WEEK } from "./workload.js";

describe("balanceInterval", () => {
  const weekday = (d: number) => d % 7;
  it("keeps short intervals and picks the lightest day in the spread", () => {
    expect(balanceInterval(2, 1, 36500, () => 0, weekday)).toBe(2);
    // 20 days: the spread is 17–23; day 22 is the only empty one.
    const due = (d: number) => (d === 22 ? 0 : 10);
    expect(balanceInterval(20, 15, 36500, due, weekday)).toBe(22);
    // Equal load: the planned interval.
    expect(balanceInterval(20, 15, 36500, () => 5, weekday)).toBe(20);
  });

  it("weighs lighter days and avoids minimum days while it can", () => {
    // Weekday 6 (day 20) is a minimum day, weekday 0 (day 21) a reduced one.
    const week = [0.5, 1, 1, 1, 1, 1, 0] as const;
    const due = (d: number) => (d === 20 ? 0 : 3);
    expect(balanceInterval(20, 15, 36500, due, weekday, week)).not.toBe(20);
    // All minimum: still a day in the spread.
    const off = [0, 0, 0, 0, 0, 0, 0] as const;
    const d = balanceInterval(20, 15, 36500, () => 1, weekday, off);
    expect(d).toBeGreaterThanOrEqual(17);
    expect(d).toBeLessThanOrEqual(23);
    expect(NORMAL_WEEK).toHaveLength(7);
    expect(mondayFirst(0)).toBe(6);
    expect(mondayFirst(1)).toBe(0);
  });
});

describe("workload estimate", () => {
  it("gives the stability at 90 % recall, longer intervals at lower recall", () => {
    expect(intervalAt(30, 0.9, 0.1542)).toBeCloseTo(30, 6);
    expect(intervalAt(30, 0.8, 0.1542)).toBeGreaterThan(30);
    expect(intervalAt(30, 0.95, 0.5)).toBeLessThan(30);
  });

  it("sums one review per interval plus the new cards", () => {
    expect(dailyLoad([10, 10], 0.9, 0.5, 0, 36500)).toBeCloseTo(0.2, 6);
    expect(dailyLoad([10, 10], 0.9, 0.5, 5, 36500)).toBeCloseTo(5.2, 6);
    // Higher target recall, more reviews.
    expect(dailyLoad([10, 40], 0.95, 0.5, 0, 36500)).toBeGreaterThan(
      dailyLoad([10, 40], 0.9, 0.5, 0, 36500),
    );
    // Never more than one a day per card, never beyond the maximum interval.
    expect(dailyLoad([0.1], 0.9, 0.5, 0, 36500)).toBe(1);
    expect(dailyLoad([1e6], 0.9, 0.5, 0, 100)).toBeCloseTo(0.01, 6);
  });
});
