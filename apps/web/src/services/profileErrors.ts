/** Errors of the language profile, kept apart so screens import them without the live services. */

/** Vuurtoren has no profile for this language yet: the learner should choose decks first. */
export class DecksNotChosenError extends Error {
  override readonly name = "DecksNotChosenError";
  constructor() {
    super("Choose which Anki decks Vuurtoren reads first.");
  }
}

/** True for DecksNotChosenError or a detection that found no deck (by name, across copies). */
export function isNoDecksError(e: unknown): boolean {
  return (
    e instanceof Error && (e.name === "DecksNotChosenError" || e.name === "NoSourceDecksError")
  );
}
