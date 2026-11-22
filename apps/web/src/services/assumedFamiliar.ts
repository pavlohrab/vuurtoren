/**
 * Cloze for beginners: the starter words below the learner's start level (`starterFrom`; start
 * level 3 means ranks 1–1000) are taken as familiar, so the reader may blank them before there
 * is any evidence. Only cloze candidacy uses this (see docs/dev/algorithms.md §3.4): glossing,
 * coverage and the known count stay with the evidence, and nothing is recorded.
 */
import { STARTER_LEVEL_SIZE, type StarterWord, starterKey } from "@app/anki";
import type { WordInfo } from "@app/db";

const NONE: ReadonlySet<string> = new Set();

export interface AssumedFamiliarDeps {
  /** The learner's start level (absent: 1). */
  starterFrom: () => Promise<number | undefined>;
  starterWords: () => Promise<readonly StarterWord[]>;
  /** The learner's words among these keys (manual states included). */
  wordsByKeys: (keys: string[]) => Promise<WordInfo[]>;
}

/**
 * Keys of the starter words below the start level, without the ones the learner set back to
 * new in the app. (Ignored words are never blanked anyway.)
 */
export async function assumedFamiliarKeys(deps: AssumedFamiliarDeps): Promise<ReadonlySet<string>> {
  const from = (await deps.starterFrom()) ?? 1;
  if (from <= 1) return NONE;
  const below = (await deps.starterWords())
    .filter((w) => w.rank <= (from - 1) * STARTER_LEVEL_SIZE)
    .map(starterKey);
  const keys = new Set(below);
  for (const w of await deps.wordsByKeys(below)) {
    if (w.overridden && (w.state === "unknown" || w.state === "seen")) keys.delete(w.key);
  }
  return keys;
}
