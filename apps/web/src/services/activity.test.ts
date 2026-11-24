import { describe, expect, it } from "vitest";
import {
  streak,
  activeDays,
  activitySince,
  firstCard,
  groupActivity,
  groupWeeks,
  knownByWeek,
  localDate,
} from "./activity.js";

describe("activity", () => {
  it("groups events into the last seven local days, oldest first", () => {
    const now = new Date(2026, 10, 17, 15, 0).getTime();
    const day = 86_400_000;
    const days = groupActivity(
      [
        { kind: "page", at: now - 1000 },
        { kind: "exercise", at: now - 1000 },
        { kind: "exercise", at: now - 2 * day },
        { kind: "added", at: now - 2 * day },
        { kind: "review", at: now - 3 * day },
        { kind: "review", at: now - 3 * day },
        { kind: "page", at: now - 30 * day }, // outside the window
      ],
      now,
    );
    expect(days).toHaveLength(7);
    expect(days[6]).toEqual({
      date: localDate(now),
      pages: 1,
      exercises: 1,
      added: 0,
      reviews: 0,
    });
    expect(days[4]).toMatchObject({ exercises: 1, added: 1 });
    // Native reviews make a day active too.
    expect(days[3]).toMatchObject({ reviews: 2, pages: 0 });
    expect(days[0]!.date).toBe(localDate(activitySince(now, 7)));
    expect(activeDays(days)).toBe(3);
  });

  it("sums days into weeks that end today", () => {
    const now = new Date(2026, 10, 17, 15, 0).getTime();
    const day = 86_400_000;
    const days = groupActivity(
      [
        { kind: "page", at: now },
        { kind: "page", at: now - 6 * day },
        { kind: "page", at: now - 7 * day },
      ],
      now,
      15,
    );
    const weeks = groupWeeks(days);
    expect(weeks).toHaveLength(2);
    expect(weeks[1]).toMatchObject({ start: localDate(now - 6 * day), pages: 2 });
    expect(weeks[0]).toMatchObject({ pages: 1 });
  });

  it("counts known words by the week their first card was made", () => {
    const now = new Date(2026, 10, 17, 15, 0).getTime();
    const day = 86_400_000;
    const points = knownByWeek(
      [null, 0, now - 1 * day, now - 10 * day, now - 100 * day, now + day],
      now,
      3,
    );
    expect(points.map((p) => p.known)).toEqual([4, 5, 6]);
    expect(points[2]!.date).toBe(localDate(now));
    expect(firstCard([1_700_000_000_002, 1_700_000_000_001])).toBe(1_700_000_000_001);
    expect(firstCard([])).toBeNull();
  });
});

describe("streak", () => {
  const day = (reviews: number) => ({ date: "", pages: 0, exercises: 0, added: 0, reviews });
  it("counts days in a row up to today, or up to yesterday while today is still empty", () => {
    expect(streak([day(1), day(0), day(3), day(2), day(5)])).toBe(3);
    expect(streak([day(1), day(2), day(4), day(0)])).toBe(3);
    expect(streak([day(1), day(0), day(0)])).toBe(0);
    expect(streak([])).toBe(0);
  });
});
