/**
 * Which exercise a word gets (docs/dev/algorithms.md 4.7.3): among the kinds the word supports,
 * the one the learner gets right about 85% of the time by the Elo model, inside a guard rail:
 * never more than one step above the hardest kind this word was answered right in. A word with a
 * card skips the step-1 kinds (its meaning is the card's job); a word marked known starts at
 * building. Also: misses per grammar point, for the next lessons and the end of a lesson.
 * Pure.
 */
import { chance, difficultyOf, gripOf, guessOf, type EloAnswer, type EloState } from "./elo.js";
import type { GripStart } from "./elo.js";
import type { WordState } from "../memory.js";
import type { Exercise, ExerciseKind } from "./types.js";

/** The ladder: 1 pick it, 2 in a sentence, 3 build it, 4 hear it and build it, 5 type it. */
export const STEP_OF: Readonly<Record<ExerciseKind, 1 | 2 | 3 | 4 | 5>> = {
  "meaning-choice": 1,
  "word-choice": 1,
  "cloze-choice": 2,
  gender: 2,
  "adjective-e": 2,
  separable: 2,
  scramble: 3,
  perfect: 5,
  "cloze-typed": 5,
  dictation: 5,
  "verb-form": 5,
};

/** The share of right answers to aim at (Wilson et al. 2019). */
export const TARGET = 0.85;

/** The grammar point a kind trains, for counting misses across words. */
export const POINT_OF: Readonly<Partial<Record<ExerciseKind, GrammarPoint>>> = {
  gender: "gender",
  "adjective-e": "adjective-e",
  perfect: "perfect",
  separable: "separable",
  "verb-form": "verb-form",
  scramble: "word-order",
};
export type GrammarPoint =
  "gender" | "adjective-e" | "perfect" | "separable" | "verb-form" | "word-order";

/** The hardest step this word was answered right in (0 when never). Half credit counts. */
export function hardestRight(answers: readonly EloAnswer[], key: string): number {
  let best = 0;
  for (const a of answers)
    if (a.key === key && a.result >= 0.5) best = Math.max(best, STEP_OF[a.kind]);
  return best;
}

/** The highest step a word may get now: one above its hardest right answer, with the floors. */
export function maxStep(info: { hardest: number; hasCard: boolean; state: WordState }): number {
  const floor = info.state === "known" ? 3 : info.hasCard ? 2 : 1;
  return Math.min(5, Math.max(floor, info.hardest + 1));
}

export interface ChooseInput {
  key: string;
  state: WordState;
  hasCard: boolean;
  start: GripStart;
  /** The exercises the generators could make for this word, one per kind. */
  candidates: readonly Exercise[];
  elo: EloState;
  answers: readonly EloAnswer[];
  /** For a word coming back after a miss: at most this step (one below the missed one). */
  cap?: number;
}

/** The chance of a right answer for this word on this exercise. */
export function chanceFor(input: Pick<ChooseInput, "elo" | "key" | "start">, ex: Exercise): number {
  return chance(
    gripOf(input.elo, input.key, input.start),
    difficultyOf(input.elo, ex.kind),
    guessOf(ex.choices?.length),
  );
}

/**
 * The exercise for a word, or null when no candidate fits. Ties go to the harder step (more
 * learning for the same chance), then the kind name, so the choice is stable.
 */
export function chooseExercise(input: ChooseInput): Exercise | null {
  let top = maxStep({
    hardest: hardestRight(input.answers, input.key),
    hasCard: input.hasCard,
    state: input.state,
  });
  if (input.cap !== undefined) top = Math.min(top, Math.max(1, input.cap));
  const fit = input.candidates.filter(
    (ex) => STEP_OF[ex.kind] <= top && !(input.hasCard && STEP_OF[ex.kind] === 1),
  );
  // A card word capped below 2 (a miss at step 2) stays at step 2 with another kind.
  const pool = fit.length
    ? fit
    : input.candidates.filter((ex) => STEP_OF[ex.kind] <= Math.max(top, 2));
  let best: Exercise | null = null;
  let bestGap = Infinity;
  for (const ex of pool) {
    const gap = Math.abs(chanceFor(input, ex) - TARGET);
    const better =
      gap < bestGap - 1e-9 ||
      (Math.abs(gap - bestGap) <= 1e-9 &&
        best !== null &&
        (STEP_OF[ex.kind] > STEP_OF[best.kind] ||
          (STEP_OF[ex.kind] === STEP_OF[best.kind] && ex.kind < best.kind)));
    if (better) {
      best = ex;
      bestGap = gap;
    }
  }
  return best;
}

/** Misses per grammar point since `since` (ms), across all words. */
export function missesByPoint(
  answers: readonly EloAnswer[],
  since: number,
): Map<GrammarPoint, number> {
  const out = new Map<GrammarPoint, number>();
  for (const a of answers) {
    const point = POINT_OF[a.kind];
    if (point && a.at >= since && a.result < 0.5) out.set(point, (out.get(point) ?? 0) + 1);
  }
  return out;
}
