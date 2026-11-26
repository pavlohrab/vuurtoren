import { describe, expect, it } from "vitest";
import { replay, type EloAnswer } from "./elo.js";
import {
  chooseExercise,
  hardestRight,
  maxStep,
  missesByPoint,
  type ChooseInput,
} from "./choose.js";
import type { Exercise, ExerciseKind } from "./types.js";

const ex = (kind: ExerciseKind, choices?: number): Exercise =>
  ({
    id: kind,
    kind,
    skill: "recognition",
    key: "huis",
    instruction: "",
    prompt: { text: "" },
    answer: "x",
    ...(choices ? { choices: Array.from({ length: choices }, (_, i) => String(i)) } : {}),
  }) as Exercise;

const ALL = [
  ex("meaning-choice", 4),
  ex("cloze-choice", 4),
  ex("gender", 2),
  ex("scramble"),
  ex("cloze-typed"),
  ex("verb-form"),
];

const input = (over: Partial<ChooseInput> = {}): ChooseInput => ({
  key: "huis",
  state: "seen",
  hasCard: false,
  start: { pKnown: 0.5, recentTaps: 0, netClozes: 0 },
  candidates: ALL,
  elo: replay([]),
  answers: [],
  ...over,
});

const a = (kind: ExerciseKind, result: number, at = 1): EloAnswer => ({
  key: "huis",
  kind,
  result,
  at,
});

describe("choosing a word's exercise (4.7.3)", () => {
  it("gives a new word without a card a choice, never typing", () => {
    expect(chooseExercise(input())!.kind).toBe("meaning-choice");
  });

  it("never gives a word with a card 'pick the meaning'", () => {
    const k = chooseExercise(input({ hasCard: true, state: "learning" }))!.kind;
    expect(["cloze-choice", "gender"]).toContain(k);
  });

  it("starts a word marked known at building at most", () => {
    expect(maxStep({ hardest: 0, hasCard: true, state: "known" })).toBe(3);
    const k = chooseExercise(
      input({
        hasCard: true,
        state: "known",
        start: { pKnown: 0.97, recentTaps: 0, netClozes: 0 },
      }),
    )!.kind;
    expect(k).toBe("scramble");
  });

  it("allows typing only one step after a right build", () => {
    const answers = [a("scramble", 1)];
    expect(hardestRight(answers, "huis")).toBe(3);
    const strong = { pKnown: 0.95, recentTaps: 0, netClozes: 0 };
    const starts = new Map([["huis", strong]]);
    const k = chooseExercise(
      input({
        hasCard: true,
        state: "learning",
        start: strong,
        answers,
        elo: replay(answers, starts),
      }),
    )!.kind;
    expect(["scramble"]).toContain(k); // step 4 kinds don't exist yet, so 3 is the top
    const typedAllowed = chooseExercise(
      input({
        hasCard: true,
        state: "learning",
        start: strong,
        answers: [a("scramble", 1), a("perfect", 1, 2)],
        elo: replay([a("scramble", 1), a("perfect", 1, 2)], starts),
      }),
    )!.kind;
    expect(["cloze-typed", "verb-form", "scramble"]).toContain(typedAllowed);
  });

  it("brings a missed word back one step easier", () => {
    const k = chooseExercise(input({ hasCard: true, state: "learning", cap: 2 }))!.kind;
    expect(["cloze-choice", "gender"]).toContain(k);
  });

  it("aims near 85%: a shaky word gets an easier kind than a strong one", () => {
    const weakStart = { pKnown: 0.1, recentTaps: 3, netClozes: 0 };
    const strongStart = { pKnown: 0.95, recentTaps: 0, netClozes: 2 };
    const answers = [a("scramble", 1), a("cloze-typed", 1, 2)];
    const elo = replay(answers, new Map([["huis", strongStart]]));
    const weak = chooseExercise(
      input({ hasCard: true, state: "learning", answers: [], elo, key: "x", start: weakStart }),
    );
    const strong = chooseExercise(
      input({ hasCard: true, state: "learning", answers, elo, start: strongStart }),
    );
    expect(weak!.kind === "cloze-choice" || weak!.kind === "gender").toBe(true);
    expect(["cloze-typed", "verb-form", "scramble"]).toContain(strong!.kind);
  });

  it("counts misses per grammar point", () => {
    const m = missesByPoint(
      [
        a("gender", 0, 5),
        a("gender", 0, 6),
        a("scramble", 0, 7),
        a("gender", 1, 8),
        a("gender", 0, 1),
      ],
      2,
    );
    expect(m.get("gender")).toBe(2);
    expect(m.get("word-order")).toBe(1);
  });
});
