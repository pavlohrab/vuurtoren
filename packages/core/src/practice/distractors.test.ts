import { describe, expect, it } from "vitest";
import { distractors } from "./distractors.js";
import { createRng } from "./rng.js";
import { nounPool, word } from "./testutil.js";

describe("distractors", () => {
  const target = word("hond", { glosses: ["dog"], zipf: 5 });

  it("returns n unique candidates of the same POS, never the word itself", () => {
    const pool = [target, ...nounPool(), word("lopen", { pos: "VERB" })];
    const out = distractors(target, pool, 3, createRng(1));
    expect(out).toHaveLength(3);
    expect(new Set(out).size).toBe(3);
    expect(out).not.toContain("hond");
    expect(out).not.toContain("lopen");
  });

  it("does not require the same article", () => {
    const pool = [
      word("huis", { article: "het", glosses: ["house"] }),
      word("man", { article: "de", glosses: ["man"] }),
    ];
    expect(distractors({ ...target, article: "de" }, pool, 2, createRng(1)).sort()).toEqual([
      "huis",
      "man",
    ]);
  });

  it("excludes synonyms (same first gloss) and same lemma under another key", () => {
    const pool = [
      word("viervoeter", { glosses: ["Dog", "quadruped"] }),
      word("hond", { key: "hond2", glosses: ["other"] }),
      word("kat", { glosses: ["cat"] }),
    ];
    expect(distractors(target, pool, 3, createRng(1))).toEqual(["kat"]);
    expect(distractors(target, pool, 3, createRng(1), "gloss")).toEqual(["cat"]);
  });

  it("returns glosses for by gloss and skips words without glosses", () => {
    const pool = [word("a", { glosses: ["alpha"] }), word("b", { glosses: [] })];
    expect(distractors(target, pool, 2, createRng(1), "gloss")).toEqual(["alpha"]);
  });

  it("deduplicates case-insensitively", () => {
    const pool = [
      word("a", { glosses: ["Same"] }),
      word("b", { glosses: ["same"] }),
      word("c", { glosses: ["other"] }),
    ];
    const out = distractors(target, pool, 3, createRng(1), "gloss");
    expect(out).toHaveLength(2);
  });

  it("prefers the Zipf band and widens stepwise when too few", () => {
    const near = [word("n1", { zipf: 5.5 }), word("n2", { zipf: 4.5 })];
    const far = [word("f1", { zipf: 7 }), word("f2", { zipf: 2 })];
    const two = distractors(target, [...far, ...near], 2, createRng(3));
    expect(two.sort()).toEqual(["n1", "n2"]);
    const four = distractors(target, [...far, ...near], 4, createRng(3));
    expect(four.sort()).toEqual(["f1", "f2", "n1", "n2"]);
    const three = distractors(target, [...far, ...near], 3, createRng(3));
    expect(three).toContain("n1");
    expect(three).toHaveLength(3);
  });

  it("prefers known/learning words", () => {
    const pool = [
      ...Array.from({ length: 6 }, (_, i) => word(`u${i}`, { state: "unknown", pKnown: 0 })),
      word("k1", { state: "known" }),
      word("l1", { state: "learning" }),
    ];
    for (let seed = 0; seed < 5; seed++) {
      expect(distractors(target, pool, 2, createRng(seed)).sort()).toEqual(["k1", "l1"]);
    }
  });

  it("returns fewer than n when the pool is small and handles an empty pool", () => {
    expect(distractors(target, [word("kat")], 3, createRng(1))).toEqual(["kat"]);
    expect(distractors(target, [], 3, createRng(1))).toEqual([]);
  });

  it("is deterministic for a seed", () => {
    const pool = nounPool(20);
    expect(distractors(target, pool, 3, createRng(9))).toEqual(
      distractors(target, pool, 3, createRng(9)),
    );
  });
});
