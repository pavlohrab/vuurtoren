const KEY = "kenning-last-text";

/** Remember the text the learner opened last (the sidebar "Read" link returns to it). */
export function writeLastText(id: string): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* storage blocked: the link falls back to the first in-progress text */
  }
}

/** The text opened last, or null when unknown or storage is unavailable. */
export function readLastText(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
