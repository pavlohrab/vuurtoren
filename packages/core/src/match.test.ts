import { describe, expect, it } from "vitest";
import { containsTerm, matchToken, normalizeKey } from "./match.js";

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
