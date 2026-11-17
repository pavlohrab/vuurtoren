import { describe, expect, it } from "vitest";
import { rankSentences } from "./sentences.js";
import type { ExampleSentence } from "./types.js";

const s = (text: string, source: ExampleSentence["source"]): ExampleSentence => ({
  text,
  target: [0, 2],
  source,
});

describe("rankSentences", () => {
  it("ranks AI sentences after Anki and text sentences, alongside Tatoeba", () => {
    const ok = "ik zie de grote hond vandaag";
    const ranked = rankSentences([
      s(ok, "tatoeba"),
      s(ok, "ai"),
      s(ok, "text"),
      s(ok, "anki"),
    ]).map((x) => x.source);
    expect(ranked).toEqual(["anki", "text", "tatoeba", "ai"]);
  });
  it("keeps input order between ai and tatoeba and prefers good length over source", () => {
    const ok = "ik zie de grote hond vandaag";
    expect(rankSentences([s(ok, "ai"), s(ok, "tatoeba")]).map((x) => x.source)).toEqual([
      "ai",
      "tatoeba",
    ]);
    expect(rankSentences([s("ik zie", "anki"), s(ok, "ai")]).map((x) => x.source)).toEqual([
      "ai",
      "anki",
    ]);
  });
});
