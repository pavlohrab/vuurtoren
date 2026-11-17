/** Test fixtures for the practice engine. */
import type { ExampleSentence, ItemState, Skill, WordData } from "./types.js";

/** Build a WordData with sensible defaults (a known noun with Zipf 5). */
export function word(lemma: string, over: Partial<WordData> = {}): WordData {
  return {
    key: lemma,
    lemma,
    pos: "NOUN",
    glosses: [`gloss-${lemma}`],
    zipf: 5,
    state: "known",
    pKnown: 0.9,
    sentences: [],
    ...over,
  };
}

/** Sentence fixture; `target` is found by searching for `surface` in `text`. */
export function sentence(
  text: string,
  surface: string,
  over: Partial<ExampleSentence> = {},
): ExampleSentence {
  const start = text.indexOf(surface);
  if (start < 0) throw new Error(`"${surface}" not in "${text}"`);
  return { text, target: [start, start + surface.length], source: "text", ...over };
}

/** Nine same-POS nouns with distinct glosses, used as a distractor pool. */
export function nounPool(count = 9): WordData[] {
  return Array.from({ length: count }, (_, i) => word(`woord${i}`, { glosses: [`meaning ${i}`] }));
}

/** An ItemState with defaults; override anything. */
export function itemState(key: string, skill: Skill, over: Partial<ItemState> = {}): ItemState {
  return {
    key,
    skill,
    due: 0,
    stability: 2,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 1,
    reps: 1,
    lapses: 0,
    state: 2,
    ...over,
  };
}
