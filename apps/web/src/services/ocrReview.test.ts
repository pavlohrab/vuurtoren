import { describe, expect, it } from "vitest";
import type { OcrFlag } from "@app/nlp-client";
import {
  acceptAllSuggestions,
  applyEditsToBlocks,
  changedCount,
  fixFlag,
  initReview,
  keepFlag,
  nextOpen,
  openCount,
  rebase,
  reopenFlag,
  reviewEdits,
  reviewText,
} from "./ocrReview.js";

const flag = (text: string, word: string, suggestions: string[] = [], from = 0): OcrFlag => {
  const start = text.indexOf(word, from);
  return {
    start,
    end: start + word.length,
    word,
    reason: "unknown",
    conf: 0.9,
    suggestions,
    box: { page: 1, x: 0, y: 0, w: 0.1, h: 0.05 },
  };
};

const TEXT = "Wij gingen sarnen naar de rnarkt en kochten vis.";

describe("ocr review state", () => {
  it("applies fixes without shifting the original offsets", () => {
    let s = initReview(TEXT, [flag(TEXT, "rnarkt", ["markt"]), flag(TEXT, "sarnen", ["samen"])]);
    expect(s.flags.map((f) => f.word)).toEqual(["sarnen", "rnarkt"]);
    s = fixFlag(s, 0, "samen");
    s = fixFlag(s, 1, "markt");
    expect(reviewText(s)).toBe("Wij gingen samen naar de markt en kochten vis.");
    expect(reviewEdits(s)).toEqual([
      { start: 11, end: 17, text: "samen" },
      { start: 26, end: 32, text: "markt" },
    ]);
    expect(changedCount(s)).toBe(2);
    s = reopenFlag(s, 0);
    expect(reviewText(s)).toContain("sarnen");
  });

  it("keeps, accepts all and finds the next open word", () => {
    let s = initReview(TEXT, [flag(TEXT, "sarnen", ["samen"]), flag(TEXT, "kochten")]);
    expect(nextOpen(s, 0, 1)).toBe(1);
    expect(nextOpen(s, 0, -1)).toBe(1);
    s = acceptAllSuggestions(s);
    expect(reviewText(s)).toContain("samen");
    expect(openCount(s)).toBe(1); // no suggestion for "kochten"
    s = keepFlag(s, 1);
    expect(openCount(s)).toBe(0);
    expect(nextOpen(s, 0, 1)).toBe(-1);
    // A "fix" equal to the recognised word is a keep.
    expect(fixFlag(initReview(TEXT, [flag(TEXT, "vis")]), 0, "vis").flags[0]?.status).toBe("kept");
  });

  it("drops overlapping and out-of-range flags", () => {
    const f = flag(TEXT, "sarnen");
    const s = initReview(TEXT, [f, { ...f, start: f.start + 2 }, { ...f, start: 90, end: 95 }]);
    expect(s.flags).toHaveLength(1);
  });

  it("rebase keeps open flags that are still there after a hand edit", () => {
    let s = initReview(TEXT, [flag(TEXT, "sarnen", ["samen"]), flag(TEXT, "rnarkt")]);
    s = fixFlag(s, 0, "samen");
    const edited = "Gisteren " + reviewText(s);
    const r = rebase(s, edited);
    expect(r.text).toBe(edited);
    expect(r.flags).toHaveLength(1);
    expect(edited.slice(r.flags[0]!.start, r.flags[0]!.end)).toBe("rnarkt");
    expect(rebase(s, "Iets heel anders.").flags).toHaveLength(0);
  });

  it("applies page edits to course blocks, merging a joined hyphenation", () => {
    const blocks = [{ text: "Verse groen-" }, { text: "ten en vis" }, { text: "Oefening 1" }];
    const page = blocks.map((b) => b.text).join("\n\n");
    const split = flag(page, "groen-\n\nten");
    const ening = flag(page, "Oefening");
    const out = applyEditsToBlocks(blocks, [
      { start: split.start, end: split.end, text: "groenten" },
      { start: ening.start, end: ening.end, text: "Opdracht" },
    ]);
    expect(out.map((b) => b.text)).toEqual(["Verse groenten en vis", "Opdracht 1"]);
    expect(applyEditsToBlocks(blocks, [])).toEqual(blocks);
  });
});
