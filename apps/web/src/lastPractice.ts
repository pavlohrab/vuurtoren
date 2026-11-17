const KEY = "kenning-practice-again";

/**
 * Words answered wrong in the last practice session: the Practice summary's "Review these
 * words" opens Words filtered to them (`/words?source=practice-again`).
 */
export function writePracticeAgain(keys: readonly string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...new Set(keys)]));
  } catch {
    /* storage blocked: the filter then shows no words */
  }
}

/** The words to look at again from the last session ([] when unknown). */
export function readPracticeAgain(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}
