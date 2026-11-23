import { describe, expect, it } from "vitest";
import {
  bandOf,
  defaultRenderMode,
  estimateVocabulary,
  textDifficulty,
  updateStaircase,
} from "./staircase.js";
import { known, learning, model } from "./testutil.js";
import type { SegmentPlan, StaircaseState } from "./types.js";

const S = (t: number, b: number): StaircaseState => ({ targetCoverage: t, newWordBudget: b });

describe("updateStaircase", () => {
  it.each([
    ["easy", S(0.98, 3), { clozeAccuracy: 0.9, lookupsPer100: 1 }, S(0.975, 4)],
    ["easy without clozes", S(0.98, 3), { clozeAccuracy: null, lookupsPer100: 0 }, S(0.975, 4)],
    [
      "boundary accuracy 0.85",
      S(0.98, 3),
      { clozeAccuracy: 0.85, lookupsPer100: 1.9 },
      S(0.975, 4),
    ],
    [
      "lookups exactly 2 is neutral",
      S(0.98, 3),
      { clozeAccuracy: 0.9, lookupsPer100: 2 },
      S(0.98, 3),
    ],
    ["middling", S(0.98, 3), { clozeAccuracy: 0.75, lookupsPer100: 3 }, S(0.98, 3)],
    ["low accuracy", S(0.98, 3), { clozeAccuracy: 0.6, lookupsPer100: 1 }, S(0.985, 2)],
    [
      "boundary accuracy 0.70 is neutral",
      S(0.98, 3),
      { clozeAccuracy: 0.7, lookupsPer100: 1 },
      S(0.98, 3),
    ],
    ["many lookups", S(0.98, 3), { clozeAccuracy: 0.95, lookupsPer100: 7 }, S(0.985, 2)],
    [
      "many lookups, no clozes",
      S(0.98, 3),
      { clozeAccuracy: null, lookupsPer100: 6.5 },
      S(0.985, 2),
    ],
    ["floor T and cap B", S(0.92, 5), { clozeAccuracy: 1, lookupsPer100: 0 }, S(0.92, 5)],
    ["cap T and floor B", S(0.99, 1), { clozeAccuracy: 0.1, lookupsPer100: 9 }, S(0.99, 1)],
    ["near floor", S(0.922, 4), { clozeAccuracy: 1, lookupsPer100: 0 }, S(0.92, 5)],
  ])("%s", (_name, state, outcome, expected) => {
    expect(updateStaircase(state, outcome)).toEqual(expected);
  });

  it("does not accumulate float error over many steps", () => {
    let s = S(0.98, 1);
    for (let i = 0; i < 12; i++) s = updateStaircase(s, { clozeAccuracy: 1, lookupsPer100: 0 });
    expect(s).toEqual(S(0.92, 5));
    for (let i = 0; i < 20; i++) s = updateStaircase(s, { clozeAccuracy: 0, lookupsPer100: 0 });
    expect(s).toEqual(S(0.99, 1));
  });
});

describe("estimateVocabulary", () => {
  it("has a floor of 200 for tiny models", () => {
    expect(estimateVocabulary(new Map())).toBe(200);
  });
  it("sums pKnown of known and learning entries only", () => {
    const entries: Record<string, ReturnType<typeof known>> = {};
    for (let i = 0; i < 300; i++) entries[`k${i}`] = known(1);
    for (let i = 0; i < 100; i++) entries[`l${i}`] = learning(0.5);
    entries["s"] = { state: "seen", pKnown: 0.9 };
    entries["u"] = { state: "unknown", pKnown: 0 };
    entries["i"] = { state: "ignored", pKnown: 1 };
    expect(estimateVocabulary(model(entries))).toBe(350);
  });
});

function plan(coverage: number, words: number, newTypes: string[] = []): SegmentPlan {
  return {
    segment: { index: 0, tokenStart: 0, tokenEnd: 0, charStart: 0, charEnd: 0 },
    tokens: Array.from({ length: words }, (_, i) => ({
      i,
      label: "known" as const,
      key: "x",
      pKnown: 1,
    })),
    coverage,
    newTypes,
    introduce: [],
    gloss: [],
    clozes: [],
  };
}

describe("textDifficulty", () => {
  it("weights coverage by word count and unions new types", () => {
    const d = textDifficulty([plan(1, 100, ["a", "b"]), plan(0.9, 300, ["b", "c"])]);
    expect(d.coverage).toBeCloseTo(0.925, 10);
    expect(d.newTypes).toBe(3);
    expect(d.band).toBe("challenging");
  });
  it("handles an empty list", () => {
    expect(textDifficulty([])).toEqual({ coverage: 1, newTypes: 0, band: "comfortable" });
  });
  it.each([
    [1, "comfortable"],
    [0.98, "comfortable"],
    [0.979, "stretch"],
    [0.95, "stretch"],
    [0.949, "challenging"],
    [0.9, "challenging"],
    [0.899, "weave"],
    [0, "weave"],
  ] as const)("band for coverage %f is %s", (c, band) => {
    expect(bandOf(c)).toBe(band);
    expect(textDifficulty([plan(c, 10)]).band).toBe(band);
  });
});

describe("defaultRenderMode", () => {
  it.each([
    [1, "graded"],
    [0.95, "graded"],
    [0.949, "glossed"],
    [0.8, "glossed"],
    [0.799, "weave"],
    [0, "weave"],
  ] as const)("coverage %f -> %s", (c, mode) => {
    expect(defaultRenderMode(c)).toBe(mode);
  });
});
