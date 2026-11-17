/** Unit progress: Anki knowledge of the unit's words plus book-exercise completion. */
import type { WordState } from "../memory.js";

export interface UnitStatus {
  /** Distinct words of the unit. */
  total: number;
  known: number;
  learning: number;
  /** In Anki (or seen) but not started: candidates for "Learn next". */
  newInAnki: number;
  /** Not in Anki at all: candidates for "Add missing words". */
  missing: number;
  /** known / total, 0 when the unit has no words. */
  knownRatio: number;
  exercisesDone: number;
  exercisesTotal: number;
}

/** What the status needs to know about one unit word: its state and whether Anki has the card. */
export interface UnitWordFact {
  state: WordState | "absent";
  inAnki: boolean;
}

/**
 * Summarise a unit. `exercisesDone` counts exercises with every item answered correctly at
 * least once (`answered` maps exercise number -> [correct items, total items]).
 */
export function unitStatus(
  words: readonly UnitWordFact[],
  exercises: readonly { number: number; items: number }[],
  answered: ReadonlyMap<number, number>,
): UnitStatus {
  let known = 0;
  let learning = 0;
  let newInAnki = 0;
  let missing = 0;
  for (const w of words) {
    if (w.state === "known" || w.state === "ignored") known++;
    else if (w.state === "learning") learning++;
    else if (w.inAnki) newInAnki++;
    else missing++;
  }
  const total = words.length;
  const exercisesDone = exercises.filter(
    (e) => e.items > 0 && (answered.get(e.number) ?? 0) >= e.items,
  ).length;
  return {
    total,
    known,
    learning,
    newInAnki,
    missing,
    knownRatio: total === 0 ? 0 : known / total,
    exercisesDone,
    exercisesTotal: exercises.length,
  };
}
