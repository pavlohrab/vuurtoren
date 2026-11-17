import { describe, expect, it } from "vitest";
import { activeDays, activitySince, groupActivity, localDate } from "./activity.js";

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
        { kind: "page", at: now - 30 * day }, // outside the window
      ],
      now,
    );
    expect(days).toHaveLength(7);
    expect(days[6]).toEqual({ date: localDate(now), pages: 1, exercises: 1, added: 0 });
    expect(days[4]).toMatchObject({ exercises: 1, added: 1 });
    expect(days[0]!.date).toBe(localDate(activitySince(now, 7)));
    expect(activeDays(days)).toBe(2);
  });
});
