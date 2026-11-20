import { describe, expect, it } from "vitest";
import { glossTargets, helpLevel, helpRecallThreshold, wantsGloss } from "./help.js";
import type { PlannedToken } from "./types.js";

const tok = (i: number, label: PlannedToken["label"], pKnown: number): PlannedToken => ({
  i,
  label,
  key: `k${i}`,
  pKnown,
});

describe("help dial", () => {
  it("maps help to a recall threshold", () => {
    expect(helpRecallThreshold(0)).toBe(0);
    expect(helpRecallThreshold(1 / 3)).toBe(0);
    expect(helpRecallThreshold(2 / 3)).toBeCloseTo(0.475, 3);
    expect(helpRecallThreshold(1)).toBe(0.95);
    expect(helpRecallThreshold(5)).toBe(0.95);
  });

  it("off translates nothing; low translates only unstudied words", () => {
    const toks = [
      tok(0, "gloss", 0),
      tok(1, "introduce", 0),
      tok(2, "learning", 0.2),
      tok(3, "known", 0.9),
    ];
    expect(glossTargets(toks, 0)).toEqual([]);
    expect(glossTargets(toks, 0.25)).toEqual([0, 1]);
  });

  it("higher help adds shaky studied words, never clozes or ignored", () => {
    expect(wantsGloss({ label: "learning", pKnown: 0.4 }, 0.7)).toBe(true);
    expect(wantsGloss({ label: "learning", pKnown: 0.6 }, 0.7)).toBe(false);
    expect(wantsGloss({ label: "known", pKnown: 0.9 }, 1)).toBe(true);
    expect(wantsGloss({ label: "known", pKnown: 0.97 }, 1)).toBe(false);
    expect(wantsGloss({ label: "cloze", pKnown: 0.1 }, 1)).toBe(false);
    expect(wantsGloss({ label: "ignored", pKnown: 1 }, 1)).toBe(false);
    expect(wantsGloss({ label: "nonword", pKnown: 0 }, 1)).toBe(false);
  });

  it("tops up to a minimum with words still being learned, once per word, never known ones", () => {
    const toks = [
      tok(0, "known", 0.8),
      tok(1, "learning", 0.3),
      { ...tok(2, "learning", 0.3), key: "k1" },
      tok(3, "known", 0.99),
      tok(4, "gloss", 0),
    ];
    expect(glossTargets(toks, 0.25, 3)).toEqual([1, 4]);
    expect(glossTargets(toks, 0.25, 5)).toEqual([1, 4]);
    expect(glossTargets(toks, 0.25, 1)).toEqual([4]);
    expect(glossTargets(toks, 0, 3)).toEqual([]);
    expect(glossTargets([tok(0, "known", 0.99)], 0.25, 2)).toEqual([]);
  });

  it("names the levels", () => {
    expect([0, 0.2, 0.6, 1].map(helpLevel)).toEqual(["off", "new", "shaky", "most"]);
  });
});
