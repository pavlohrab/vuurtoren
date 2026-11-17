import { describe, expect, it } from "vitest";
import { type DetectFn, type NoteSample, rankCandidates } from "./detect.js";

const NL = new Set([
  "fiets",
  "het huis",
  "lopen",
  "gezellig",
  "opbellen",
  "Ik bel je morgen op.",
  "De fiets is rood.",
  "Wij lopen naar huis.",
]);
const EN = new Set(["bike", "house", "to walk", "cozy", "to call", "apple", "dog", "cat"]);
const detect: DetectFn = async (texts) =>
  texts.map((t) => ({ lang: NL.has(t) ? "nl" : EN.has(t) ? "en" : "fr", confidence: 0.8 }));

const nlNotes: NoteSample[] = [
  ["fiets", "bike", "De fiets is rood."],
  ["het huis", "house", "Wij lopen naar huis."],
  ["lopen", "to walk", "Wij lopen naar huis."],
  ["gezellig", "cozy", "Ik bel je morgen op."],
].map(([w, g, s]) => ({
  deck: "Nederlands::Woorden",
  deckNoteCount: 2000,
  modelName: "Vocab",
  fields: { Back: g!, Front: `<b>${w}</b>`, Sentence: s! },
}));

const enNotes: NoteSample[] = ["apple", "dog", "cat"].map((w) => ({
  deck: "Biology",
  deckNoteCount: 5000,
  modelName: "Basic",
  fields: { Front: w, Back: w },
}));

describe("rankCandidates", () => {
  it("finds the Dutch deck, word, sentence and gloss fields", async () => {
    const [top, ...rest] = await rankCandidates([...enNotes, ...nlNotes], detect, "nl");
    expect(top).toMatchObject({
      deck: "Nederlands::Woorden",
      wordField: "Front",
      sentenceField: "Sentence",
      glossField: "Back",
      targetShare: 1,
    });
    expect(rest).toHaveLength(0);
  });

  it("returns nothing without target-language fields", async () => {
    expect(await rankCandidates(enNotes, detect, "nl")).toEqual([]);
  });
});
