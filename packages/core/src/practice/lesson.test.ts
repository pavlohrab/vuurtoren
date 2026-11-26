import { describe, expect, it } from "vitest";
import { UNGRADED, buildLesson, comeBack, extraTile, weakPoints } from "./lesson.js";
import { STEP_OF } from "./choose.js";
import { rankSentences } from "./sentences.js";
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
    const lesson = buildLesson(
      { words, signals, states: [], answers: [], now: NOW },
      createRng(1),
    ).filter((e) => !UNGRADED.has(e.kind));
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
    expect(lesson.filter((e) => !UNGRADED.has(e.kind))).toHaveLength(5);
    const only = buildLesson(
      { words, signals, states: [], answers: [], now: NOW, only: new Set(["huis"]) },
      createRng(3),
    );
    expect(only.filter((e) => !UNGRADED.has(e.kind)).map((e) => e.key)).toEqual(["huis"]);
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

  it("builds only from short sentences of known words, and says where you met the word", () => {
    const hard = word("gracht", {
      state: "known",
      pKnown: 0.97,
      sentences: [
        sentence("Langs de oude gracht in het centrum stonden vroeger veel pakhuizen.", "gracht", {
          translation: "Along the old canal…",
          source: "text",
          unknown: 3,
        }),
        sentence("Ze fietst langs de gracht.", "gracht", {
          translation: "She cycles along the canal.",
          source: "tatoeba",
          unknown: 0,
        }),
      ],
    });
    const lesson = buildLesson(
      {
        words: [hard, ...pool],
        signals: [sig("gracht", { state: "known", pKnown: 0.97 })],
        states: [],
        answers: [],
        now: NOW,
      },
      createRng(8),
    );
    const ex = lesson.find((e) => e.key === "gracht")!;
    expect(ex.kind).toBe("scramble");
    expect(ex.answer).toBe("Ze fietst langs de gracht.");
    expect(ex.metIn?.text).toMatch(/^Langs de oude gracht/);
  });

  it("adds one tile that doesn't belong when building", () => {
    expect(extraTile(["ze", "fietst", "langs", "de", "gracht"])).toBe("het");
    expect(extraTile(["hij", "loopt", "snel"])).toBe("loop");
    const ex = buildLesson(
      {
        words: [
          word("gracht", {
            state: "known",
            pKnown: 0.97,
            sentences: [
              sentence("Ze fietst langs de gracht.", "gracht", {
                translation: "She cycles along the canal.",
                unknown: 0,
              }),
            ],
          }),
          ...pool,
        ],
        signals: [sig("gracht", { state: "known", pKnown: 0.97 })],
        states: [],
        answers: [],
        now: NOW,
      },
      createRng(9),
    ).find((e) => e.kind === "scramble")!;
    expect(ex.pieces).toContain("het");
    expect(ex.pieces).toHaveLength(6);
    expect(ex.topic).toBe("word-order-v2");
    expect(ex.explanation).toMatch(/verb comes second/);
  });

  it("shows new words first and warms up with pairs when three or more words start at step 1", () => {
    const fresh = ["kat", "hond", "vis"].map((w, i) =>
      word(w, { state: "seen", pKnown: 0.2, glosses: [`animal ${i}`], article: "de" }),
    );
    const lesson = buildLesson(
      {
        words: [...fresh, ...pool],
        signals: fresh.map((w) =>
          sig(w.key, { state: "seen", hasCard: false, pKnown: 0.2, taps: 2 }),
        ),
        states: [],
        answers: [],
        now: NOW,
      },
      createRng(10),
    );
    expect(lesson.slice(0, 3).map((e) => e.kind)).toEqual(["meet", "meet", "meet"]);
    expect(lesson[0]!.prompt.hint).toMatch(/^animal/);
    const pairs = lesson.find((e) => e.kind === "pairs")!;
    expect(pairs.pairs).toHaveLength(3);
    expect(pairs.pairs![0]).toMatchObject({ nl: expect.stringMatching(/^de /) });
  });

  it("uses your own sentence first, and keeps gap sentences within your reading level", () => {
    const deur = word("deur", {
      state: "learning",
      pKnown: 0.5,
      article: "de",
      sentences: [
        sentence("De deur is open.", "deur", {
          source: "anki",
          translation: "The door is open.",
          unknown: 0,
        }),
        sentence("Hij doet de deur dicht.", "deur", {
          source: "text",
          translation: "He closes the door.",
          unknown: 0,
          first: true,
        }),
      ],
    });
    expect(rankSentences(deur.sentences)[0]!.text).toBe("Hij doet de deur dicht.");

    // One unknown word in a four-word gap sentence is 25%: above a 95% reading target.
    const hard = word("trap", {
      state: "known",
      pKnown: 0.97,
      sentences: [
        sentence("Hij beklimt de trap.", "trap", {
          translation: "He climbs the stairs.",
          unknown: 1,
        }),
      ],
    });
    const kinds = buildLesson(
      {
        words: [hard, ...pool],
        signals: [sig("trap", { state: "known", pKnown: 0.97 })],
        states: [],
        answers: [],
        now: NOW,
        coverage: 0.95,
      },
      createRng(12),
    ).map((e) => e.prompt.sentence);
    expect(kinds).not.toContain("Hij beklimt de trap.");
  });
});
