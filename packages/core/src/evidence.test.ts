import { describe, expect, it } from "vitest";
import {
  APP_MAX_P,
  addEvidence,
  answerEvidence,
  evidenceRecall,
  isAppLearning,
  withAppEvidence,
} from "./evidence.js";

const DAY = 86_400_000;
const T0 = 1_700_000_000_000;
const many = (n: number, correct = true) =>
  Array.from({ length: n }, (_, i) => answerEvidence("practice", correct, T0 + i)).reduce(
    (a, b) => addEvidence(a, b),
    undefined as ReturnType<typeof answerEvidence> | undefined,
  )!;

describe("app evidence", () => {
  it("sums answers independently of order", () => {
    const a = answerEvidence("cloze", true, T0, true);
    const b = answerEvidence("book", false, T0 + 5);
    const c = answerEvidence("practice", true, T0 + 9);
    expect(addEvidence(addEvidence(a, b), c)).toEqual(addEvidence(addEvidence(c, a), b));
    expect(addEvidence(addEvidence(a, b), c)).toEqual({
      correct: 1.5,
      wrong: 1,
      lastAt: T0 + 9,
      lastCorrect: true,
    });
  });

  it("lets a wrong answer win a tie", () => {
    const e = addEvidence(answerEvidence("cloze", true, T0), answerEvidence("cloze", false, T0));
    expect(e.lastCorrect).toBe(false);
  });

  it("grows with correct answers, stays below the ceiling and fades", () => {
    expect(evidenceRecall(many(1), T0)).toBeCloseTo(0.4);
    expect(evidenceRecall(many(3), T0 + 2)).toBeCloseTo(0.6);
    expect(evidenceRecall(many(50), T0 + 49)).toBeLessThan(APP_MAX_P);
    expect(evidenceRecall(many(3), T0 + 2 + 30 * DAY)).toBeCloseTo(0.3);
    expect(evidenceRecall(many(3, false), T0)).toBe(0);
  });

  it("needs three correct answers, the last one correct, to show as learning", () => {
    expect(isAppLearning(many(2), T0)).toBe(false);
    expect(isAppLearning(many(3), T0)).toBe(true);
    const lastWrong = addEvidence(many(5), answerEvidence("practice", false, T0 + 100));
    expect(isAppLearning(lastWrong, T0 + 100)).toBe(false);
    expect(isAppLearning(many(3), T0 + 60 * DAY)).toBe(false);
  });

  it("never changes known or ignored words and never makes a word known", () => {
    const known = { state: "known" as const, pKnown: 0.7 };
    expect(withAppEvidence(known, many(2, false), T0)).toMatchObject(known);
    expect(withAppEvidence({ state: "ignored", pKnown: 1 }, many(9), T0).state).toBe("ignored");
    const r = withAppEvidence(undefined, many(20), T0 + 20);
    expect(r).toMatchObject({ state: "learning", appLearning: true });
    expect(r.pKnown).toBeLessThan(APP_MAX_P);
  });

  it("raises unknown or seen words and keeps the higher pKnown", () => {
    const u = withAppEvidence({ state: "unknown", pKnown: 0 }, many(1), T0);
    expect(u).toMatchObject({ state: "unknown", raised: true, appLearning: false });
    expect(u.pKnown).toBeCloseTo(0.4);
    const l = withAppEvidence({ state: "learning", pKnown: 0.7 }, many(3), T0 + 2);
    expect(l).toMatchObject({ state: "learning", pKnown: 0.7, raised: false, appLearning: false });
    expect(withAppEvidence(undefined, many(1, false), T0).state).toBe("seen");
  });
});
