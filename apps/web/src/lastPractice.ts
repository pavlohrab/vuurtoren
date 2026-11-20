import { readLocalJSON, writeLocalJSON } from "./storage/local.js";

const KEY = "vuurtoren-practice-again";

/**
 * Words answered wrong in the last practice session: the Practice summary's "Review these
 * words" opens Words filtered to them (`/words?source=practice-again`).
 */
export function writePracticeAgain(keys: readonly string[]): void {
  writeLocalJSON(KEY, [...new Set(keys)]);
}

/** The words to look at again from the last session ([] when unknown). */
export function readPracticeAgain(): string[] {
  const v = readLocalJSON(KEY);
  return Array.isArray(v) ? v.filter((k): k is string => typeof k === "string") : [];
}
