import { describe, expect, it } from "vitest";
import { segmentTokens } from "./segment.js";
import { filler, tokenize } from "./testutil.js";

const wordsIn = (toks: ReturnType<typeof tokenize>, s: { tokenStart: number; tokenEnd: number }) =>
  toks.slice(s.tokenStart, s.tokenEnd).filter((t) => t.is_word).length;

describe("segmentTokens", () => {
  it("returns [] for empty input", () => {
    expect(segmentTokens([])).toEqual([]);
  });

  it("rejects a non-positive target", () => {
    expect(() => segmentTokens(tokenize("a b."), 0)).toThrow(RangeError);
  });

  it("keeps a short text in one segment with char range from offsets", () => {
    const text = "Ik ben hier. Jij ook.";
    const toks = tokenize(text);
    const segs = segmentTokens(toks);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toEqual({
      index: 0,
      tokenStart: 0,
      tokenEnd: toks.length,
      charStart: 0,
      charEnd: text.length,
    });
  });

  it.each([
    [10, 10, 30], // 100 words, target 30 -> several segments
    [30, 5, 40],
  ])("segments %i sentences x %i words near target %i", (n, w, target) => {
    const toks = tokenize(filler(n, w));
    const segs = segmentTokens(toks, target);
    expect(segs.length).toBeGreaterThan(1);
    // consecutive, covering, never splitting a sentence
    expect(segs[0]!.tokenStart).toBe(0);
    expect(segs.at(-1)!.tokenEnd).toBe(toks.length);
    segs.forEach((s, k) => {
      expect(s.index).toBe(k);
      if (k > 0) expect(s.tokenStart).toBe(segs[k - 1]!.tokenEnd);
      const first = toks[s.tokenStart]!;
      const prev = toks[s.tokenStart - 1];
      if (prev) expect(prev.sent).not.toBe(first.sent);
      expect(wordsIn(toks, s)).toBeLessThanOrEqual(target * 1.5);
    });
  });

  it("gives one very long sentence its own segment", () => {
    const text = `${filler(1, 5)} ${filler(1, 200)} ${filler(1, 5)}`;
    const toks = tokenize(text);
    const segs = segmentTokens(toks, 50);
    const long = segs.find((s) => wordsIn(toks, s) >= 200);
    expect(long).toBeDefined();
    const sents = new Set(toks.slice(long!.tokenStart, long!.tokenEnd).map((t) => t.sent));
    // the long sentence is entirely inside this segment
    expect(toks.filter((t) => t.sent === 1).every((t) => sents.has(t.sent))).toBe(true);
    expect(toks.slice(long!.tokenStart, long!.tokenEnd).filter((t) => t.sent === 1)).toHaveLength(
      201,
    );
  });

  it("cuts at a blank line where plain size heuristics would not", () => {
    // 3 sentences x 10 words, target 40: without text -> single segment (30 < 40).
    const text = `${filler(1, 10)} ${filler(1, 10)}\n\n${filler(1, 10)}`;
    const toks = tokenize(text);
    expect(segmentTokens(toks, 40)).toHaveLength(1);
    // with text: 20 words >= 0.67*40? 20 < 26.8 -> still no cut
    expect(segmentTokens(toks, 40, text)).toHaveLength(1);
    // target 30: 20 >= 20.1? no. target 28: 20 >= 18.8 yes -> cut at paragraph
    const segs = segmentTokens(toks, 28, text);
    expect(segs).toHaveLength(2);
    expect(wordsIn(toks, segs[0]!)).toBe(20);
    expect(wordsIn(toks, segs[1]!)).toBe(10);
  });

  it("ignores single newlines", () => {
    const text = `${filler(1, 10)} ${filler(1, 10)}\n${filler(1, 10)}`;
    const toks = tokenize(text);
    expect(segmentTokens(toks, 28, text)).toHaveLength(1);
  });

  it("is deterministic", () => {
    const toks = tokenize(filler(20, 12));
    expect(segmentTokens(toks, 50)).toEqual(segmentTokens(toks, 50));
  });
});
