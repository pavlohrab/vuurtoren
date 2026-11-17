import { describe, expect, it } from "vitest";
import {
  type Candidate,
  type DetectFn,
  type NoteSample,
  rankCandidates,
  selectCandidates,
} from "./detect.js";

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
// Mimics lingua's worst case: numbers come back as "nl".
const detect: DetectFn = async (texts) =>
  texts.map((t) => ({
    lang: NL.has(t) || /^[\d.]+$/.test(t) ? "nl" : EN.has(t) ? "en" : "fr",
    confidence: 0.8,
  }));

const nlNotes: NoteSample[] = [
  ["fiets", "bike", "De fiets is rood."],
  ["het huis", "house", "Wij lopen naar huis."],
  ["lopen", "to walk", "Wij lopen naar huis."],
  ["gezellig", "cozy", "Ik bel je morgen op."],
].map(([w, g, s]) => ({
  deck: "Nederlands::Woorden",
  deckNoteCount: 2000,
  modelName: "Vocab",
  fields: { Back: g!, Freq: "17.31", Front: `<b>${w}</b>`, Sentence: s! },
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

describe("selectCandidates", () => {
  const cand = (deck: string, model: string, share: number, samples = 30): Candidate => ({
    deck,
    modelName: model,
    noteCount: 100,
    wordField: "Woord",
    sentenceField: null,
    glossField: null,
    targetShare: share,
    score: share,
    fields: [{ name: "Woord", samples, targetShare: share, glossShare: 0, avgTokens: 1 }],
    examples: [],
  });

  it("keeps a below-threshold deck when its note type passes pooled", () => {
    const picked = selectCandidates(
      [
        cand("Thema 01", "Opmaat", 0.7),
        cand("Thema 02", "Opmaat", 0.65),
        cand("Thema 03", "Opmaat", 0.47),
        cand("Misc", "Basic", 0.45),
      ],
      0.5,
    ).map((c) => c.deck);
    expect(picked).toEqual(["Thema 01", "Thema 02", "Thema 03"]);
  });
});

describe("gloss field choice", () => {
  it("prefers a short word gloss over a sentence translation", async () => {
    const notes: NoteSample[] = [
      ["al", "already", "Het is al laat.", "It is already late."],
      ["fiets", "bike", "De fiets is rood.", "The bike is red."],
      ["lopen", "to walk", "Wij lopen naar huis.", "We walk home."],
    ].map(([w, g, s, t]) => ({
      deck: "Opmaat",
      deckNoteCount: 200,
      modelName: "Woord",
      fields: { Woord: w!, Betekenis: g!, Zin: s!, ZinEN: t! },
    }));
    const nl = new Set([
      "al",
      "fiets",
      "lopen",
      "Het is al laat.",
      "De fiets is rood.",
      "Wij lopen naar huis.",
    ]);
    const det: DetectFn = async (texts) =>
      texts.map((t) => ({ lang: nl.has(t) ? "nl" : "en", confidence: 0.9 }));
    const [top] = await rankCandidates(notes, det, "nl");
    expect(top).toMatchObject({
      wordField: "Woord",
      sentenceField: "Zin",
      glossField: "Betekenis",
    });
  });
});
