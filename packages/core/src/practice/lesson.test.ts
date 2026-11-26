import { describe, expect, it } from "vitest";
import { buildLesson, comeBack, weakPoints } from "./lesson.js";
import { STEP_OF } from "./choose.js";
import { createRng } from "./rng.js";
import type { WordSignals } from "./select.js";
import { itemState, nounPool, sentence, word } from "./testutil.js";
import type { WordData } from "./types.js";

const NOW = 1_800_000_000_000;

const sig = (key: string, over: Partial<WordSignals> = {}): WordSignals => ({
  key,
  state: "learning",
  pKnown: 0.5,
  hasCard: true,
  taps: 0,
  recentTaps: 0,
  netClozes: 0,
  reviewedToday: false,
  practiceSafe: false,
  onPage: false,
  onNextPages: false,
  zipf: 5,
  dismissed: false,
  ...over,
});

const pool = nounPool();
const huis = word("huis", {
  article: "het",
  state: "learning",
  pKnown: 0.5,
  sentences: [sentence("Het huis is groot en mooi.", "huis", { translation: "The house is big." })],
});
const fiets = word("fiets", {
  article: "de",
  state: "seen",
  pKnown: 0.2,
  sentences: [
    sentence("De fiets staat bij de deur.", "fiets", { translation: "The bike is by the door." }),
  ],
});
const words: WordData[] = [huis, fiets, ...pool];
const signals = [
  sig("huis"),
  sig("fiets", { state: "seen", hasCard: false, pKnown: 0.2, taps: 3 }),
];

describe("a lesson (4.7)", () => {
  it("gives each picked word one exercise, card words never 'pick the meaning'", () => {
    const lesson = buildLesson({ words, signals, states: [], answers: [], now: NOW }, createRng(1));
    const keys = lesson.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(expect.arrayContaining(["huis", "fiets"]));
    const forHuis = lesson.find((e) => e.key === "huis")!;
    expect(STEP_OF[forHuis.kind]).toBeGreaterThanOrEqual(2);
    const forFiets = lesson.find((e) => e.key === "fiets")!;
    expect(STEP_OF[forFiets.kind]).toBe(1); // no card, never answered: pick it
  });

  it("stays within the size and the lesson's source", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      word(`w${i}`, { state: "learning", pKnown: 0.5 }),
    );
    const s = many.map((w) => sig(w.key, { hasCard: false }));
    const lesson = buildLesson(
      { words: [...many, ...pool], signals: s, states: [], answers: [], now: NOW, size: 5 },
      createRng(2),
    );
    expect(lesson).toHaveLength(5);
    const only = buildLesson(
      { words, signals, states: [], answers: [], now: NOW, only: new Set(["huis"]) },
      createRng(3),
    );
    expect(only.map((e) => e.key)).toEqual(["huis"]);
  });

  it("puts due words in, and is the same for the same input", () => {
    const states = [itemState("huis", "gender", { due: NOW - 1 })];
    const a = buildLesson({ words, signals, states, answers: [], now: NOW }, createRng(4));
    const b = buildLesson({ words, signals, states, answers: [], now: NOW }, createRng(4));
    expect(a.map((e) => e.kind + e.key)).toEqual(b.map((e) => e.kind + e.key));
    expect(a[0]!.key === "huis" || a.some((e) => e.key === "huis")).toBe(true);
  });

  it("brings a missed word back one step easier, with another kind", () => {
    const lesson = buildLesson({ words, signals, states: [], answers: [], now: NOW }, createRng(5));
    const missed = lesson.find((e) => e.key === "huis")!;
    const back = comeBack(
      missed,
      {
        words,
        signals,
        states: [],
        answers: [{ key: "huis", kind: missed.kind, result: 0, at: NOW }],
        now: NOW,
      },
      createRng(6),
    );
    expect(back).not.toBeNull();
    expect(back!.kind).not.toBe(missed.kind);
    expect(STEP_OF[back!.kind]).toBeLessThanOrEqual(Math.max(2, STEP_OF[missed.kind] - 1));
  });

  it("marks a grammar point weak after two misses in a week", () => {
    const at = NOW - 86_400_000;
    const answers = [
      { key: "a", kind: "gender" as const, result: 0, at },
      { key: "b", kind: "gender" as const, result: 0, at },
    ];
    expect([...weakPoints(answers, NOW)]).toEqual(["gender"]);
    expect(weakPoints(answers.slice(0, 1), NOW).size).toBe(0);
  });

  it("never builds a sentence that has no English", () => {
    const bare = word("brug", {
      state: "known",
      pKnown: 0.97,
      sentences: [sentence("De brug over de gracht is dicht.", "brug")],
    });
    const lesson = buildLesson(
      {
        words: [bare, ...pool],
        signals: [sig("brug", { state: "known", pKnown: 0.97 })],
        states: [],
        answers: [],
        now: NOW,
      },
      createRng(7),
    );
    expect(lesson.some((e) => e.kind === "scramble")).toBe(false);
  });
});
