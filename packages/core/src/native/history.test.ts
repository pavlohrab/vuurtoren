import { describe, expect, it } from "vitest";
import { answerCard, formatInterval } from "./schedule.js";
import { reviewHistory } from "./history.js";
import { DEFAULT_DECK_OPTIONS } from "./types.js";

const DAY = 86_400_000;
const T = Date.UTC(2026, 10, 1, 12);
const ctx = { options: DEFAULT_DECK_OPTIONS, params: [] as number[], fuzz: false };

describe("reviewHistory", () => {
  it("lists the latest answers newest first with the interval each gave", () => {
    const reviews = [
      { cardId: 1, at: T, rating: 3 as const, kind: "learn" as const, durationMs: 0 },
      { cardId: 1, at: T + 600_000, rating: 3 as const, kind: "learn" as const, durationMs: 0 },
      { cardId: 1, at: T + 2 * DAY, rating: 0 as const, kind: "manual" as const, durationMs: 0 },
      { cardId: 1, at: T + 3 * DAY, rating: 1 as const, kind: "review" as const, durationMs: 0 },
    ];
    // The last answer shows the due date the card really got.
    const current = {
      ...answerCard(undefined, 1, T + 3 * DAY, ctx),
      due: T + 3 * DAY + 5 * 60_000,
    };
    const h = reviewHistory([{ reviews, schedule: current, options: DEFAULT_DECK_OPTIONS }], []);
    expect(h.map((r) => r.rating)).toEqual([1, 3, 3]);
    expect(h[0]!.interval).toBe("5m");
    expect(h[2]!.interval).toBe("10m");
    const first = answerCard(answerCard(undefined, 3, T, ctx), 3, T + 600_000, ctx);
    expect(h[1]!.interval).toBe(formatInterval(first.due - (T + 600_000)));
    expect(reviewHistory([{ reviews, options: DEFAULT_DECK_OPTIONS }], [], 2)).toHaveLength(2);
  });
});
