import { describe, expect, it } from "vitest";
import {
  type SentenceGrammarHit,
  generateSentences,
  parseSentences,
  sentenceRequestText,
} from "./examples.js";
import { fakeAnalyze, fakeProvider, modelOf } from "./test-util.js";

const model = modelOf([
  "ik",
  "heb",
  "een",
  "nieuwe",
  "de",
  "is",
  "rood",
  "en",
  "snel",
  "morgen",
  "ga",
  "naar",
  "school",
  "wij",
  "fietsen",
  "graag",
  "samen",
]);
const base = { vocabEstimate: 800, knownLemmas: ["ik", "heb", "een"] };
const answer = (...texts: string[]) =>
  JSON.stringify({ sentences: texts.map((text) => ({ text, translation: `EN ${text}` })) });

describe("parsing", () => {
  it("accepts objects and plain strings, rejects non-JSON", () => {
    expect(
      parseSentences('{"sentences": ["Ik heb een fiets.", {"text": "x", "translation": "y"}]}'),
    ).toEqual([{ text: "Ik heb een fiets." }, { text: "x", translation: "y" }]);
    expect(parseSentences("no json")).toBeUndefined();
  });
  it("puts the target in the user message (static, cacheable system prompt)", () => {
    expect(sentenceRequestText({ ...base, lemma: "fiets", count: 4 })).toContain('"fiets"');
  });
});

describe("generateSentences validation", () => {
  it("keeps valid sentences with the target span and translation", async () => {
    const p = fakeProvider([answer("Ik heb een nieuwe fiets")]);
    const r = await generateSentences(
      { provider: p, analyze: fakeAnalyze, model },
      { ...base, lemma: "fiets" },
    );
    expect(r.rejected).toEqual([]);
    expect(r.accepted).toEqual([
      {
        text: "Ik heb een nieuwe fiets",
        translation: "EN Ik heb een nieuwe fiets",
        target: [18, 23],
      },
    ]);
    expect(p.calls[0]!.json).toBe(true);
  });

  it("rejects a missing target, low coverage, a leaked target, bad length and duplicates", async () => {
    const p = fakeProvider([
      answer(
        "Ik heb een nieuwe auto", // missing target
        "De fiets is ontzettend schitterend opgepoetst", // 3 unknown words
        "Ik heb een fiets naar school", // leaks another (known) target
        "Fiets", // too short
        "De fiets is rood en snel", // ok
        "de fiets is  rood en snel", // duplicate
        "Ik heb een oude fiets", // existing sentence
      ),
    ]);
    const r = await generateSentences(
      {
        provider: p,
        analyze: fakeAnalyze,
        model,
        avoid: ["school", "fiets"],
        existing: ["Ik heb een oude fiets"],
      },
      { ...base, lemma: "fiets" },
    );
    expect(r.accepted.map((s) => s.text)).toEqual(["De fiets is rood en snel"]);
    expect(r.rejected.map((s) => s.reason)).toEqual([
      "missing-target",
      "coverage",
      "leak",
      "length",
      "duplicate",
      "duplicate",
    ]);
  });

  it("allows one unknown word only in a long enough sentence (coverage >= 0.9)", async () => {
    const p = fakeProvider([
      answer(
        "Ik heb een nieuwe fiets voor school",
        "Ik heb morgen een nieuwe fiets en ga graag samen naar school vandaag",
      ),
    ]);
    const r = await generateSentences(
      { provider: p, analyze: fakeAnalyze, model },
      { ...base, lemma: "fiets" },
    );
    // "voor" is unknown in a 7-word sentence (86%); "vandaag" in a 14-word one (93%).
    expect(r.rejected.map((x) => x.reason)).toEqual(["coverage"]);
    expect(r.accepted).toHaveLength(1);
  });

  it("requires the grammar detector to fire for the topic and keeps its marks and note", async () => {
    const grammar = (text: string): Promise<SentenceGrammarHit[]> =>
      Promise.resolve(
        text.startsWith("Morgen")
          ? [
              {
                topic: "inversion",
                tokens: [0, 1],
                start: 0,
                end: text.length,
                note: "verb second",
              },
            ]
          : [{ topic: "perfect", tokens: [0], start: 0, end: text.length, note: "" }],
      );
    const p = fakeProvider([
      answer("Morgen ga ik naar school", "Wij fietsen graag samen naar school"),
    ]);
    const r = await generateSentences(
      { provider: p, analyze: fakeAnalyze, model, detectGrammar: grammar },
      { ...base, grammar: { title: "Inversion", detects: ["inversion"] } },
    );
    expect(r.accepted).toEqual([
      {
        text: "Morgen ga ik naar school",
        translation: "EN Morgen ga ik naar school",
        marks: [
          [0, 6],
          [7, 9],
        ],
        note: "verb second",
      },
    ]);
    expect(r.rejected).toEqual([
      { text: "Wij fietsen graag samen naar school", reason: "grammar" },
    ]);
  });

  it("rejects everything when the language server cannot check, and flags invalid JSON", async () => {
    const down = await generateSentences(
      {
        provider: fakeProvider([answer("Ik heb een nieuwe fiets")]),
        analyze: () => Promise.reject(new Error("503")),
        model,
      },
      { ...base, lemma: "fiets" },
    );
    expect(down.accepted).toEqual([]);
    expect(down.rejected[0]!.reason).toBe("analysis");
    const bad = await generateSentences(
      { provider: fakeProvider(["sorry"]), analyze: fakeAnalyze, model },
      { ...base, lemma: "fiets" },
    );
    expect(bad).toMatchObject({ accepted: [], rejected: [], parseFailed: true });
  });
});
