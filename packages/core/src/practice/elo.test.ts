import { describe, expect, it } from "vitest";
import {
  START_DIFFICULTY,
  chance,
  difficultyOf,
  gripOf,
  guessOf,
  replay,
  startGrip,
  stepSize,
  type EloAnswer,
} from "./elo.js";

const ans = (key: string, kind: EloAnswer["kind"], result: number, at: number, choices?: number) =>
  ({ key, kind, result, at, ...(choices ? { choices } : {}) }) as EloAnswer;

describe("Elo for exercises (4.7.3)", () => {
  it("starts a word's grip from recall, taps and clozes", () => {
    const base = startGrip({ pKnown: 0.5, recentTaps: 0, netClozes: 0 });
    expect(base).toBeCloseTo(0);
    expect(startGrip({ pKnown: 0.5, recentTaps: 2, netClozes: 0 })).toBeCloseTo(-0.6);
    expect(startGrip({ pKnown: 0.5, recentTaps: 0, netClozes: 1 })).toBeCloseTo(0.3);
    // Recall is clamped, so a "certain" word stays finite.
    expect(startGrip({ pKnown: 1, recentTaps: 0, netClozes: 0 })).toBeCloseTo(Math.log(19));
  });

  it("counts a lucky guess on multiple choice", () => {
    expect(guessOf(4)).toBe(0.25);
    expect(guessOf(undefined)).toBe(0);
    expect(chance(-10, 0, 0.25)).toBeCloseTo(0.25, 3);
    expect(chance(0, 0)).toBe(0.5);
  });

  it("makes easy kinds likelier than hard ones for the same word", () => {
    const theta = 0;
    expect(chance(theta, START_DIFFICULTY["meaning-choice"])).toBeGreaterThan(
      chance(theta, START_DIFFICULTY["cloze-typed"]),
    );
  });

  it("raises the grip after a right answer and lowers it after a wrong one", () => {
    const right = replay([ans("huis", "cloze-choice", 1, 1, 4)]);
    const wrong = replay([ans("huis", "cloze-choice", 0, 1, 4)]);
    expect(gripOf(right, "huis")).toBeGreaterThan(0);
    expect(gripOf(wrong, "huis")).toBeLessThan(0);
    // A kind you get wrong becomes harder for you.
    expect(difficultyOf(wrong, "cloze-choice")).toBeGreaterThan(START_DIFFICULTY["cloze-choice"]);
  });

  it("moves half as far for a hinted answer", () => {
    const full = gripOf(replay([ans("x", "scramble", 1, 1)]), "x");
    const half = gripOf(replay([ans("x", "scramble", 0.5, 1)]), "x");
    expect(half).toBeLessThan(full);
    // 0.5 against p = σ(0 + 0.4) ≈ 0.6: a small step down, not a miss.
    expect(half).toBeLessThan(0);
    expect(half).toBeGreaterThan(-0.2);
  });

  it("takes smaller steps as answers pile up", () => {
    expect(stepSize(0)).toBeGreaterThan(stepSize(10));
  });

  it("gives the same numbers whatever order the answers arrive in", () => {
    const a = [
      ans("huis", "cloze-choice", 1, 3, 4),
      ans("fiets", "gender", 0, 1, 2),
      ans("huis", "scramble", 0, 2),
      ans("fiets", "gender", 1, 4, 2),
    ];
    const one = replay(a);
    const two = replay([...a].reverse());
    expect([...one.grip]).toEqual([...two.grip]);
    expect([...one.difficulty]).toEqual([...two.difficulty]);
  });

  it("uses the start grip for a word's first answer", () => {
    const starts = new Map([["huis", { pKnown: 0.9, recentTaps: 0, netClozes: 0 }]]);
    const s = replay([ans("huis", "cloze-typed", 1, 1)], starts);
    expect(gripOf(s, "huis")).toBeGreaterThan(startGrip(starts.get("huis")!));
    expect(gripOf(s, "fiets", { pKnown: 0.2, recentTaps: 0, netClozes: 0 })).toBeLessThan(0);
  });
});
