import type { Attempt, Exercise, Grade } from "./types.js";

/** Typed answers faster than this (ms, without hints) are graded "easy". */
export const FAST_TYPED_MS = 4000;

/**
 * Map an attempt to an FSRS grade.
 * wrong -> again; correct with hints -> hard; choice/ordering correct -> good
 * (guessing is possible, so never easy, however fast); typed correct -> good,
 * or easy when fast (< 4 s) and no hints.
 */
export function gradeAttempt(exercise: Exercise, attempt: Attempt): Grade {
  if (!attempt.correct) return "again";
  // Hints that give away half the letters (or the whole answer) mean it was not recalled.
  const letters = [...exercise.answer].filter((c) => /\p{L}/u.test(c)).length;
  if (attempt.hintsUsed > 0 && attempt.hintsUsed >= Math.ceil(letters / 2)) return "again";
  if (attempt.hintsUsed > 0) return "hard";
  const typed = exercise.choices === undefined && exercise.pieces === undefined;
  return typed && attempt.ms < FAST_TYPED_MS ? "easy" : "good";
}
