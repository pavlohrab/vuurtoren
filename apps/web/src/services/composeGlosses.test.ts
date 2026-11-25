import { describe, expect, it } from "vitest";
import { composeGlosses } from "./liveDictionary.js";

const entry = (pos: string, glosses: string[], article?: string) => ({
  pos,
  glosses,
  ...(article ? { article } : {}),
});

describe("composeGlosses article", () => {
  const haar = [entry("pron", ["her"]), entry("det", ["her"]), entry("noun", ["hair"], "het")];

  it("gives no article to a pronoun that also has a noun sense", () => {
    expect(composeGlosses(null, haar as never, "PRON").article).toBeUndefined();
    expect(composeGlosses(null, haar as never, "DET").article).toBeUndefined();
  });

  it("takes the noun's article when the word is used as a noun", () => {
    expect(composeGlosses(null, haar as never, "NOUN").article).toBe("het");
  });

  it("without a part of speech, uses the first sense", () => {
    expect(composeGlosses(null, haar as never, "").article).toBeUndefined();
    const huis = [entry("noun", ["house"], "het")];
    expect(composeGlosses(null, huis as never, "").article).toBe("het");
  });
});

describe("composeGlosses meanings", () => {
  it("doesn't say the same meaning twice", () => {
    const burgemeester = [
      {
        pos: "noun",
        article: "de",
        glosses: ["mayor, burgomaster", "mayor, burgomaster (head of a city or municipality)"],
      },
    ];
    const got = composeGlosses({ gloss: "mayor" } as never, burgemeester as never, "NOUN").glosses;
    expect(got).toEqual(["mayor, burgomaster"]);
  });

  it("keeps meanings that differ", () => {
    const kijken = [
      { pos: "verb", article: null, glosses: ["to look", "to watch (e.g. a film), to observe"] },
    ];
    expect(composeGlosses(null, kijken as never, "VERB").glosses).toEqual([
      "to look",
      "to watch (e.g. a film), to observe",
    ]);
  });
});
