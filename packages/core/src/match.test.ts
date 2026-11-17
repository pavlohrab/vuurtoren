import { describe, expect, it } from "vitest";
import { containsTerm, matchToken, matchTokenDetailed, normalizeKey } from "./match.js";

const toks = (pairs: [string, string][]) => pairs.map(([text, lemma]) => ({ text, lemma }));

describe("matching", () => {
  it("normalizes case and curly apostrophes", () => {
    expect(normalizeKey("Zo’n ")).toBe("zo'n");
  });

  it("matches by lemma, then surface", () => {
    const keys = new Set(["lopen", "kinderen"]);
    expect(matchToken({ text: "liep", lemma: "lopen" }, keys)).toBe("lopen");
    expect(matchToken({ text: "kinderen", lemma: "kind" }, keys)).toBe("kinderen");
    expect(matchToken({ text: "fiets", lemma: "fiets" }, keys)).toBeUndefined();
    expect(
      matchToken(
        { text: "sleept", lemma: "binnenslepen", alt_lemmas: ["slepen"] },
        new Set(["slepen"]),
      ),
    ).toBe("slepen");
  });

  it("finds single and multiword terms in a sentence", () => {
    const s = toks([
      ["Het", "het"],
      ["huis", "huis"],
      ["staat", "staan"],
      ["te", "te"],
      ["koop", "koop"],
    ]);
    expect(containsTerm(s, "staan")).toBe(true);
    expect(containsTerm(s, "te koop")).toBe(true);
    expect(containsTerm(s, "koop te")).toBe(false);
    expect(containsTerm(s, "fiets")).toBe(false);
    expect(containsTerm(s, "")).toBe(false);
  });
});

describe("review fixes", () => {
  it("normalises like the Python side (NFKC, quotes, lower, no casefold)", () => {
    expect(normalizeKey("Straße")).toBe("straße");
    expect(normalizeKey("ﬁets")).toBe("fiets");
    expect(normalizeKey("zo’n")).toBe("zo'n");
  });

  it("prefers lemma and surface over alternative lemmas", () => {
    const t = { text: "bellen", lemma: "bellen", alt_lemmas: ["bel"] };
    expect(matchTokenDetailed(t, new Set(["bel", "bellen"]))).toEqual({
      key: "bellen",
      via: "lemma",
    });
    expect(matchTokenDetailed(t, new Set(["bel"]))).toEqual({ key: "bel", via: "alt" });
    const liep = { text: "liep", lemma: "lopen" };
    expect(matchTokenDetailed(liep, new Set(["liep", "lopen"]))?.via).toBe("lemma");
  });

  it("backtracks for multiword terms", () => {
    const s = toks([
      ["a", "a"],
      ["b", "b"],
      ["x", "x"],
      ["x", "x"],
      ["b", "b"],
      ["x", "x"],
      ["x", "x"],
      ["x", "x"],
      ["c", "c"],
    ]);
    expect(containsTerm(s, "a b c")).toBe(true);
    expect(containsTerm(s, "a c")).toBe(false);
  });
});
