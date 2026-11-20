/**
 * Starter levels on the Words screen: a word's level comes from its rank in the starter list
 * (`content/starter/nl-5000.json`; ranks 1–500 are level 1), looked up by lemma key, so it works
 * whether or not the starter decks exist. Words outside the list are "Other words".
 */
import { type StarterWord, starterKey, starterLevelOfRank } from "@app/anki";
import type { WordState } from "@app/core";

/** Ranks and levels of the starter list, by key. */
export interface StarterIndex {
  rank: ReadonlyMap<string, number>;
  /** Every level, in order, with its first and last rank and its number of words. */
  levels: readonly { level: number; from: number; to: number; size: number }[];
}

/** The `level` search param: a level, or "other" for words outside the list. */
export type LevelFilter = number | "other";

export function starterIndex(words: readonly StarterWord[]): StarterIndex {
  const rank = new Map<string, number>();
  const levels = new Map<number, { level: number; from: number; to: number; size: number }>();
  for (const w of words) {
    const key = starterKey(w);
    // A key listed twice keeps its best rank.
    if (!rank.has(key)) rank.set(key, w.rank);
    const level = starterLevelOfRank(w.rank);
    const l = levels.get(level);
    if (l) {
      l.from = Math.min(l.from, w.rank);
      l.to = Math.max(l.to, w.rank);
      l.size++;
    } else levels.set(level, { level, from: w.rank, to: w.rank, size: 1 });
  }
  return { rank, levels: [...levels.values()].sort((a, b) => a.level - b.level) };
}

/** The level of a word, or null when it is not a starter word. */
export function levelOf(index: StarterIndex, key: string): number | null {
  const r = index.rank.get(key);
  return r === undefined ? null : starterLevelOfRank(r);
}

/** "Level 1 · 1–500"; null: "Other words". */
export function levelLabel(index: StarterIndex, level: number | null): string {
  const l = level === null ? undefined : index.levels.find((x) => x.level === level);
  if (!l) return level === null ? "Other words" : `Level ${level}`;
  return `Level ${l.level} · ${l.from}–${l.to}`;
}

/** The `level` search param: "1"…"10" or "other"; anything else is no filter. */
export function parseLevel(raw: string | undefined, index?: StarterIndex): LevelFilter | null {
  if (raw === "other") return "other";
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (n < 1 || (index && !index.levels.some((l) => l.level === n))) return null;
  return n;
}

/** Keep the rows of one level (or the words outside the list). */
export function inLevel<T extends { key: string }>(
  rows: readonly T[],
  index: StarterIndex,
  level: LevelFilter,
): T[] {
  return rows.filter((r) => {
    const l = levelOf(index, r.key);
    return level === "other" ? l === null : l === level;
  });
}

export interface LevelGroup<T> {
  /** null: Other words. */
  level: number | null;
  rows: T[];
}

/**
 * Rows grouped by level, levels in order and words by rank within one; Other words last, in
 * the order they came.
 */
export function groupByLevel<T extends { key: string }>(
  rows: readonly T[],
  index: StarterIndex,
): LevelGroup<T>[] {
  const groups = new Map<number | null, T[]>();
  for (const r of rows) {
    const l = levelOf(index, r.key);
    const g = groups.get(l);
    if (g) g.push(r);
    else groups.set(l, [r]);
  }
  const rank = (r: T) => index.rank.get(r.key) ?? 0;
  return [...groups]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a - b))
    .map(([level, list]) => ({
      level,
      rows: level === null ? list : [...list].sort((x, y) => rank(x) - rank(y)),
    }));
}

/** How far the learner is in one level. */
export interface LevelProgress {
  level: number;
  size: number;
  known: number;
  learning: number;
}

/** Known and learning words per level, from the learner's words (other keys are ignored). */
export function levelProgress(
  index: StarterIndex,
  words: readonly { key: string; state: WordState }[],
): LevelProgress[] {
  const out = new Map(
    index.levels.map((l) => [l.level, { level: l.level, size: l.size, known: 0, learning: 0 }]),
  );
  for (const w of words) {
    const l = levelOf(index, w.key);
    const p = l === null ? undefined : out.get(l);
    if (!p) continue;
    if (w.state === "known") p.known++;
    else if (w.state === "learning") p.learning++;
  }
  return [...out.values()];
}

/** "312 of 500 known · 48 learning" (the learning part only when there are some). */
export function progressText(p: LevelProgress): string {
  return `${p.known} of ${p.size} known${p.learning ? ` · ${p.learning} learning` : ""}`;
}
