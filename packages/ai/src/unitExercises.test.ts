import { describe, expect, it } from "vitest";
import { checkBookItem } from "@app/core";
import type { SentenceGrammarHit } from "./examples.js";
import { fakeAnalyze, fakeProvider, modelOf } from "./test-util.js";
import {
  generateUnitExercises,
  parseUnitExercises,
  sentenceChunks,
  unitExerciseRequestText,
} from "./unitExercises.js";

const model = modelOf([
  "ik",
  "de",
  "in",
  "een",
  "op",
  "is",
  "het",
  "wij",
  "morgen",
  "gaan",
  "naar",
  "graag",
  "koop",
  "brood",
  "bij",
  "anna",
  "woont",
  "stad",
  "kleine",
  "elke",
  "dag",
  "ze",
  "markt",
  "kaas",
]);
const words = [
  { lemma: "bakker", article: "de", gloss: "baker" },
  { lemma: "winkel", article: "de", gloss: "shop" },
  { lemma: "fiets", article: "de", gloss: "bicycle" },
  { lemma: "goedkoop", gloss: "cheap" },
  { lemma: "markt", article: "de", gloss: "market" },
];
const base = {
  unitTitle: "Thema 3 Winkelen",
  words,
  vocabEstimate: 900,
  knownLemmas: ["ik", "de"],
  random: () => 0.3,
};
const seq = (xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length] ?? 0;
};

describe("unit exercises", () => {
  it("asks for the book's kinds with the unit words and grammar point", () => {
    const text = unitExerciseRequestText({
      ...base,
      kinds: ["gapfill", "questions"],
      grammar: { id: "inversion", title: "Inversie", detects: ["inversion"] },
    });
    expect(text).toContain("bakker, winkel");
    expect(text).toContain("Inversie");
    expect(text).toContain('"gapfill"');
    expect(text).not.toContain('"order"');
    expect(parseUnitExercises("nope")).toBeUndefined();
    expect(sentenceChunks("Morgen ga ik naar de bakker.")).toEqual([
      "Morgen",
      "ga",
      "ik",
      "naar",
      "de",
      "bakker",
    ]);
  });

  it("keeps validated items only, and the book checkers grade them", async () => {
    const answer = JSON.stringify({
      gapfill: [
        { sentence: "Ik koop brood bij de bakker", answer: "bakker", lemma: "bakker" },
        { sentence: "Anna woont in de kleine stad", answer: "stad", lemma: "stad" }, // not a unit word
        { sentence: "De fiets", answer: "fiets", lemma: "fiets" }, // too short
        {
          sentence: "Wij gaan morgen naar de onbekende verre winkel",
          answer: "winkel",
          lemma: "winkel",
        }, // 2 unknown
      ],
      order: [
        { sentence: "Morgen gaan wij naar de markt" },
        { sentence: "Wij gaan graag naar de markt" }, // grammar detector does not fire
      ],
      text: {
        title: "Anna",
        text: "Anna woont in een kleine stad. Elke dag gaat ze naar de markt. Ze koopt graag kaas bij de bakker.",
        questions: [
          {
            question: "Waar woont Anna?",
            options: ["In een kleine stad", "Op de markt"],
            answer: 0,
          },
          { question: "Wat koopt ze?", options: ["Fietsen", "Fietsen"], answer: 0 }, // duplicate options
          { question: "Wanneer?", options: ["Nooit", "Gisteravond laat"], answer: 1 }, // not in the text
        ],
      },
    });
    const detectGrammar = async (s: string): Promise<SentenceGrammarHit[]> =>
      s.startsWith("Morgen")
        ? [{ topic: "inversion", tokens: [0, 1], start: 0, end: 11, note: "" }]
        : [];
    const r = await generateUnitExercises(
      {
        provider: fakeProvider([answer]),
        analyze: fakeAnalyze,
        model,
        detectGrammar,
        random: seq([0.7, 0.1, 0.5]),
      },
      {
        ...base,
        kinds: ["gapfill", "sentence-building", "questions", "matching"],
        grammar: { id: "inversion", title: "Inversie", detects: ["inversion"] },
      },
    );
    expect(r.parseFailed).toBe(false);
    const byType = Object.fromEntries(r.exercises.map((e) => [e.instruction.split(" ")[0], e]));
    const gap = r.exercises.find((e) => e.type === "gapfill")!;
    expect(gap.items.map((i) => [i.prompt, i.answer])).toEqual([
      ["Ik koop brood bij de ____ (bakker)", "bakker"],
    ]);
    expect(checkBookItem("gapfill", gap.items[0]!, "Bakker").correct).toBe(true);

    const order = r.exercises.find((e) => e.type === "sentence-building")!;
    expect(order.items).toHaveLength(1);
    expect(order.grammar).toBe("inversion");
    expect(
      checkBookItem("sentence-building", order.items[0]!, "Morgen gaan wij naar de markt.").correct,
    ).toBe(true);

    const reading = r.exercises.find((e) => e.passage)!;
    expect(reading.items.map((i) => i.prompt)).toEqual(["Waar woont Anna?"]);
    expect(checkBookItem("choice", reading.items[0]!, "In een kleine stad").correct).toBe(true);

    expect(byType["Match"]?.items.length).toBe(5);
    expect(r.rejected.map((x) => x.reason).sort()).toEqual(
      ["coverage", "grammar", "length", "missing-target", "options", "text"].sort(),
    );
  });

  it("makes matching without a provider call", async () => {
    const p = fakeProvider([]);
    const r = await generateUnitExercises(
      { provider: p, analyze: fakeAnalyze, model },
      { ...base, kinds: ["matching"] },
    );
    expect(p.calls).toHaveLength(0);
    expect(r.exercises[0]?.items[0]?.options).toHaveLength(4);
  });
});
