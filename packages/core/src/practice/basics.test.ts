import { describe, expect, it } from "vitest";
import { checkAnswer } from "./check.js";
import { gradeAttempt } from "./grade.js";
import { createRng, shuffle } from "./rng.js";
import { practiceStats, review } from "./schedule.js";
import { itemState } from "./testutil.js";
import type { Attempt, Exercise } from "./types.js";

const DAY = 86_400_000;

function ex(over: Partial<Exercise>): Exercise {
  return {
    id: "x",
    kind: "cloze-typed",
    skill: "recall",
    key: "k",
    instruction: "",
    prompt: { text: "" },
    answer: "één",
    ...over,
  };
}

describe("createRng", () => {
  it("is deterministic and in [0,1)", () => {
    const a = createRng(7);
    const b = createRng(7);
    const xs = Array.from({ length: 50 }, () => a());
    expect(xs).toEqual(Array.from({ length: 50 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(createRng(8)()).not.toBe(createRng(7)());
  });

  it("shuffle keeps elements and does not mutate", () => {
    const src = [1, 2, 3, 4, 5, 6];
    const out = shuffle(src, createRng(1));
    expect([...out].sort()).toEqual(src);
    expect(src).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("checkAnswer", () => {
  it("normalises case, whitespace and NFC", () => {
    const e = ex({ answer: "één" });
    expect(checkAnswer(e, "  ÉÉN ")).toEqual({ correct: true });
    expect(checkAnswer(e, "één")).toEqual({ correct: true });
  });

  it("accepts listed alternatives", () => {
    expect(checkAnswer(ex({ answer: "heb", accept: ["ben"] }), "Ben").correct).toBe(true);
  });

  it("accepts missing accents with a note", () => {
    expect(checkAnswer(ex({ answer: "één" }), "een")).toEqual({
      correct: true,
      note: "Mind the accents: één",
    });
  });

  it("rejects wrong and empty answers", () => {
    expect(checkAnswer(ex({ answer: "één" }), "twee").correct).toBe(false);
    expect(checkAnswer(ex({ answer: "één" }), "  ").correct).toBe(false);
  });

  it("requires an exact choice for choice exercises", () => {
    const e = ex({ kind: "gender", choices: ["de", "het"], answer: "het" });
    expect(checkAnswer(e, "het").correct).toBe(true);
    expect(checkAnswer(e, " het ").correct).toBe(true);
    expect(checkAnswer(e, "Het").correct).toBe(false);
    expect(checkAnswer(e, "de").correct).toBe(false);
  });

  it("scramble ignores final punctuation and capitalisation", () => {
    const e = ex({
      kind: "scramble",
      pieces: ["a", "b"],
      answer: "Ik bel hem morgen op.",
    });
    expect(checkAnswer(e, "ik bel hem morgen op").correct).toBe(true);
    expect(checkAnswer(e, "Ik bel hem morgen op!").correct).toBe(true);
    expect(checkAnswer(e, "Ik bel morgen hem op.").correct).toBe(false);
  });

  it("treats curly and straight apostrophes alike", () => {
    expect(checkAnswer(ex({ answer: "zo'n" }), "zo\u2019n").correct).toBe(true);
    expect(checkAnswer(ex({ answer: "zo\u2019n" }), "zo'n").correct).toBe(true);
  });

  it("word answers ignore edge punctuation", () => {
    expect(checkAnswer(ex({ answer: "loopt" }), "loopt.").correct).toBe(true);
    expect(checkAnswer(ex({ answer: "loopt" }), " \u201cloopt\u201d ").correct).toBe(true);
  });

  it("dictation ignores commas, quotes and case", () => {
    const e = ex({ kind: "dictation", skill: "listening", answer: "Ja, ik kom morgen." });
    expect(checkAnswer(e, "ja ik kom morgen").correct).toBe(true);
    expect(
      checkAnswer(ex({ kind: "dictation", answer: "\u201cZo'n huis!\u201d" }), "zo\u2019n huis")
        .correct,
    ).toBe(true);
    expect(
      checkAnswer(ex({ kind: "dictation", answer: "Een zwart-wit foto." }), "een zwart-wit foto")
        .correct,
    ).toBe(true);
    expect(checkAnswer(e, "ja ik kom gisteren").correct).toBe(false);
  });

  it("dictation ignores final punctuation", () => {
    const e = ex({ kind: "dictation", skill: "listening", answer: "Goedemorgen." });
    expect(checkAnswer(e, "goedemorgen").correct).toBe(true);
  });
});

describe("gradeAttempt", () => {
  const attempt = (over: Partial<Attempt>): Attempt => ({
    exerciseId: "x",
    answer: "",
    correct: true,
    hintsUsed: 0,
    ms: 8000,
    ...over,
  });
  const choice = ex({ choices: ["a", "b"] });
  const typed = ex({});
  const order = ex({ kind: "scramble", pieces: ["a"] });

  it("wrong -> again", () => {
    expect(gradeAttempt(typed, attempt({ correct: false }))).toBe("again");
    expect(gradeAttempt(choice, attempt({ correct: false, hintsUsed: 1 }))).toBe("again");
  });
  it("hints -> hard", () => {
    expect(gradeAttempt(typed, attempt({ hintsUsed: 1, ms: 500 }))).toBe("hard");
    expect(gradeAttempt(choice, attempt({ hintsUsed: 1 }))).toBe("hard");
  });
  it("hints revealing half the letters or more -> again", () => {
    const long = ex({ answer: "wandelen" });
    expect(gradeAttempt(long, attempt({ hintsUsed: 3 }))).toBe("hard");
    expect(gradeAttempt(long, attempt({ hintsUsed: 4 }))).toBe("again");
    expect(gradeAttempt(long, attempt({ hintsUsed: 8 }))).toBe("again");
  });
  it("choice correct -> good, even when fast", () => {
    expect(gradeAttempt(choice, attempt({}))).toBe("good");
    expect(gradeAttempt(choice, attempt({ ms: 1000 }))).toBe("good");
    expect(gradeAttempt(order, attempt({ ms: 1000 }))).toBe("good");
  });
  it("typed correct -> good, fast -> easy", () => {
    expect(gradeAttempt(typed, attempt({ ms: 8000 }))).toBe("good");
    expect(gradeAttempt(typed, attempt({ ms: 3999 }))).toBe("easy");
    expect(gradeAttempt(typed, attempt({ ms: 4000 }))).toBe("good");
  });
});

describe("review", () => {
  const t0 = Date.UTC(2026, 0, 1);

  it("first review creates a card", () => {
    const s = review(undefined, "huis", "gender", "good", t0);
    expect(s).toMatchObject({ key: "huis", skill: "gender", reps: 1, lastReview: t0 });
    expect(s.due).toBeGreaterThan(t0);
    expect(s.stability).toBeGreaterThan(0);
  });

  it("is deterministic (no fuzz)", () => {
    const a = review(review(undefined, "k", "recall", "good", t0), "k", "recall", "good", t0 + DAY);
    const b = review(review(undefined, "k", "recall", "good", t0), "k", "recall", "good", t0 + DAY);
    expect(a).toEqual(b);
  });

  it("good reviews graduate and intervals grow", () => {
    let s = review(undefined, "k", "recall", "good", t0);
    let now = s.due;
    const intervals: number[] = [];
    for (let i = 0; i < 5; i++) {
      s = review(s, "k", "recall", "good", now);
      intervals.push(s.scheduledDays);
      now = s.due;
    }
    expect(s.state).toBe(2);
    expect(intervals[intervals.length - 1]!).toBeGreaterThan(intervals[0]!);
  });

  it("again on a review card lapses into relearning", () => {
    let s = review(undefined, "k", "recall", "easy", t0);
    s = review(s, "k", "recall", "good", s.due);
    expect(s.state).toBe(2);
    const lapsed = review(s, "k", "recall", "again", s.due);
    expect(lapsed.state).toBe(3);
    expect(lapsed.lapses).toBe(1);
    expect(lapsed.due).toBeLessThan(s.due + DAY);
  });

  it("again on a new card keeps it in learning", () => {
    expect(review(undefined, "k", "recall", "again", t0).state).toBe(1);
  });

  it("easy gives a longer interval than good", () => {
    const g = review(review(undefined, "k", "form", "good", t0), "k", "form", "good", t0 + DAY);
    const e = review(review(undefined, "k", "form", "good", t0), "k", "form", "easy", t0 + DAY);
    expect(e.scheduledDays).toBeGreaterThan(g.scheduledDays);
  });

  it("records elapsed days", () => {
    const s = review(undefined, "k", "form", "good", t0);
    expect(review(s, "k", "form", "good", t0 + 3 * DAY).elapsedDays).toBeCloseTo(3);
  });
});

describe("practiceStats", () => {
  it("counts due, learned and per-skill pairs", () => {
    const now = 1000;
    const stats = practiceStats(
      [
        itemState("a", "recall", { due: 500, state: 2 }),
        itemState("b", "recall", { due: 1000, state: 1 }),
        itemState("c", "gender", { due: 2000, state: 2 }),
      ],
      now,
    );
    expect(stats.due).toBe(2);
    expect(stats.learned).toBe(2);
    expect(stats.bySkill).toEqual({ recognition: 0, recall: 2, form: 0, gender: 1, listening: 0 });
  });

  it("handles no states", () => {
    expect(practiceStats([], 0)).toEqual({
      due: 0,
      learned: 0,
      bySkill: { recognition: 0, recall: 0, form: 0, gender: 0, listening: 0 },
    });
  });
});
