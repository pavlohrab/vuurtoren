/**
 * A text's rough level (m5, LV7; .plan/notes/levels.md): the first band of the starter list
 * that holds 95% of the text's running words. A1 is the first 1000 words, A2 2000, B1 3500, B2
 * the whole list: the same bands the bundled stories are written to. Names, numbers and the
 * detached half of a split verb don't count. Checked on the 35 stories: 18 on their own level,
 * 34 within one. NT2Lex was tried too and was too coarse for texts (every story came out A2).
 */
import { starterKey } from "@app/anki";
import { grammarTopic } from "@app/content";
import type { AnalyzedToken } from "@app/core";
import { wordKey } from "@app/core";
import { loadStarterWords } from "./starterWords.js";

export type RoughLevel = "A1" | "A2" | "B1" | "B2" | "C1";

const BANDS: [RoughLevel, number][] = [
  ["A1", 1000],
  ["A2", 2000],
  ["B1", 3500],
  ["B2", 4930],
];
const SHARE = 0.95;

/** The text's rough level from its tokens and the starter list's ranks; null for no words. */
export function roughTextLevel(
  tokens: readonly AnalyzedToken[],
  rank: ReadonlyMap<string, number>,
): RoughLevel | null {
  const ranks = tokens
    .filter((t) => t.is_word && !t.is_propn && !t.is_num && t.particle_of === null)
    .map((t) => rank.get(wordKey("nl", t.lemma)) ?? Infinity);
  if (!ranks.length) return null;
  for (const [level, limit] of BANDS) {
    if (ranks.filter((r) => r <= limit).length / ranks.length >= SHARE) return level;
  }
  return "C1";
}

let ranks: Promise<ReadonlyMap<string, number>> | null = null;

/** The starter list's rank per key (loaded once, with the list's own chunk). */
export function starterRanks(): Promise<ReadonlyMap<string, number>> {
  ranks ??= loadStarterWords().then((words) => {
    const m = new Map<string, number>();
    for (const w of words) if (!m.has(starterKey(w))) m.set(starterKey(w), w.rank);
    return m;
  });
  return ranks;
}

/** Share of a text's grammar hits whose topic level is at or below the text's grammar level. */
const GRAMMAR_SHARE = 0.8;
/** Fewer hits than this say nothing about a text's grammar. */
const MIN_HITS = 3;
const LEVELS: RoughLevel[] = ["A1", "A2", "B1", "B2", "C1"];

/**
 * A text's grammar level (LV8, notes/levels.md): the first level that holds 80% of its grammar
 * hits, by their topics' levels. On the 35 stories 33 come out within one level of the one they
 * were written to; A1 stories come out A2 (they use the perfect tense and split verbs, A2
 * topics), which is true of them. Null with fewer than three hits.
 */
export function grammarLevel(hits: readonly { topic: string }[]): RoughLevel | null {
  const levels = hits
    .map((h) => grammarTopic(h.topic)?.level as RoughLevel | undefined)
    .filter((l): l is RoughLevel => !!l && LEVELS.includes(l));
  if (levels.length < MIN_HITS) return null;
  for (const level of LEVELS) {
    const at = LEVELS.indexOf(level);
    if (levels.filter((l) => LEVELS.indexOf(l) <= at).length / levels.length >= GRAMMAR_SHARE)
      return level;
  }
  return "C1";
}

/** "A1 words · A2 grammar" (either part alone when the other is unknown); null for neither. */
export function levelsLine(
  words: string | null | undefined,
  grammar: string | null | undefined,
): string | null {
  const parts = [words ? `${words} words` : null, grammar ? `${grammar} grammar` : null].filter(
    Boolean,
  );
  return parts.length ? parts.join(" · ") : null;
}
