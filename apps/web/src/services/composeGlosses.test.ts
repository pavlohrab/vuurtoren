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
