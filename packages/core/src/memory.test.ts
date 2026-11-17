import { describe, expect, it } from "vitest";
import { classifyCard, fsrsFactor, mergeKnowledge, retrievability } from "./memory.js";

const DAY = 86_400_000;

describe("retrievability", () => {
  it("uses F = 19/81 for the default decay", () => {
    expect(fsrsFactor()).toBeCloseTo(19 / 81, 10);
  });

  it("is 1 right after review and 0.9 after S days", () => {
    expect(retrievability(0, 10)).toBe(1);
    expect(retrievability(10, 10)).toBeCloseTo(0.9, 10);
    expect(retrievability(10, 10, 0.2)).toBeCloseTo(0.9, 10);
  });

  it("decreases over time and handles bad stability", () => {
    expect(retrievability(30, 10)).toBeLessThan(retrievability(5, 10));
    expect(retrievability(5, 0)).toBe(0);
  });
});

describe("classifyCard", () => {
  const now = Date.UTC(2026, 10, 17);

  it("treats new cards as unknown", () => {
    expect(classifyCard({ intervalDays: 0, isNew: true }, now)).toEqual({
      state: "unknown",
      pKnown: 0,
    });
  });

  it("marks mature cards as known", () => {
    expect(classifyCard({ intervalDays: 30 }, now).state).toBe("known");
  });

  it("marks young cards as learning with interval-based p", () => {
    const k = classifyCard({ intervalDays: 7 }, now);
    expect(k.state).toBe("learning");
    expect(k.pKnown).toBeCloseTo(7 / 21);
  });

  it("uses SM-2 decay since last review when there is no FSRS state", () => {
    const due = classifyCard({ intervalDays: 10, lastReviewMs: now - 10 * DAY }, now);
    expect(due.pKnown).toBeCloseTo(0.9);
    const overdue = classifyCard({ intervalDays: 30, lastReviewMs: now - 90 * DAY }, now);
    expect(overdue.state).toBe("known");
    expect(overdue.pKnown).toBeCloseTo(0.729);
    expect(classifyCard({ intervalDays: 30, lastReviewMs: now }, now).pKnown).toBe(1);
  });

  it("uses FSRS retrievability when available", () => {
    const k = classifyCard({ intervalDays: 5, stabilityDays: 5, lastReviewMs: now - 5 * DAY }, now);
    expect(k.state).toBe("learning");
    expect(k.pKnown).toBeCloseTo(0.9, 6);
  });

  it("counts high stability with high recall as known", () => {
    const k = classifyCard(
      { intervalDays: 14, stabilityDays: 40, lastReviewMs: now - 2 * DAY },
      now,
    );
    expect(k.state).toBe("known");
  });
});

describe("mergeKnowledge", () => {
  it("keeps the stronger state, then the higher probability", () => {
    expect(
      mergeKnowledge({ state: "learning", pKnown: 0.95 }, { state: "known", pKnown: 0.8 }).state,
    ).toBe("known");
    expect(
      mergeKnowledge({ state: "learning", pKnown: 0.4 }, { state: "learning", pKnown: 0.6 }).pKnown,
    ).toBe(0.6);
  });
});
