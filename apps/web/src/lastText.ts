import { readLocal, writeLocal } from "./storage/local.js";

const KEY = "vuurtoren-last-text";

/** Remember the text the learner opened last (Home's "Continue reading" returns to it). */
export function writeLastText(id: string): void {
  writeLocal(KEY, id);
}

/** The text opened last, or null when unknown or storage is unavailable. */
export function readLastText(): string | null {
  return readLocal(KEY);
}
