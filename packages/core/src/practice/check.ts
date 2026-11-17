import type { Exercise } from "./types.js";

/** NFC + trim + collapse inner whitespace + lowercase. */
export function normalizeAnswer(s: string): string {
  return s.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Remove combining marks (één -> een). */
export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");
}

/** Drop trailing sentence punctuation (used for sentence-level answers). */
function stripFinalPunctuation(s: string): string {
  return s.replace(/[\s.!?…]+$/u, "");
}

/**
 * Check a learner's answer.
 * - Choice exercises (`choices`): exact match with the answer (after NFC + trim).
 * - Scramble (`pieces`) and dictation: case-insensitive, final punctuation ignored.
 * - Other typed exercises: case-insensitive; `answer` and `accept` are valid;
 *   a missing diacritic is still correct but comes with a note ("Mind the accents: één").
 */
export function checkAnswer(
  exercise: Exercise,
  answer: string,
): { correct: boolean; note?: string } {
  if (exercise.choices) {
    return { correct: answer.normalize("NFC").trim() === exercise.answer.normalize("NFC") };
  }
  const sentenceLevel = exercise.pieces !== undefined || exercise.kind === "dictation";
  const norm = (s: string) => {
    const n = normalizeAnswer(s);
    return sentenceLevel ? stripFinalPunctuation(n) : n;
  };
  const given = norm(answer);
  if (given === "") return { correct: false };
  const accepted = [exercise.answer, ...(exercise.accept ?? [])];
  if (accepted.some((a) => norm(a) === given)) return { correct: true };
  const hit = accepted.find((a) => stripAccents(norm(a)) === stripAccents(given));
  if (hit !== undefined) return { correct: true, note: `Mind the accents: ${hit}` };
  return { correct: false };
}
