/**
 * Which words go into a lesson (docs/dev/algorithms.md 4.7.2): due items first, then the words
 * with the highest need × use. Need says the word is fragile (recall halfway, tapped a lot or
 * lately, missed lately); use says it is worth it now (frequent, on the page just read, on the
 * next pages). Ignored and dismissed words, words reviewed with a card today and words that are
 * safe on every side are left out (safe words keep a small score, as an occasional check).
 * Pure: the caller passes the clock.
 */
import type { WordState } from "../memory.js";

const DAY_MS = 86_400_000;

/** What the app knows about one word, for choosing (4.7.1). */
export interface WordSignals {
  key: string;
  state: WordState;
  /** Recall now from the learner model, 0..1. */
  pKnown: number;
  /** Has a card (Anki or the app's own): its meaning is the card's job. */
  hasCard: boolean;
  /** Taps on the word, ever, and the newest one (ms). */
  taps: number;
  lastTapAt?: number;
  /** Taps in the last 14 days (for the Elo start). */
  recentTaps: number;
  /** Reader clozes right minus wrong (hinted count half). */
  netClozes: number;
  /** Newest wrong answer anywhere (reader cloze or practice), ms. */
  lastWrongAt?: number;
  /** The word's card was reviewed today (the app's own cards; unknown in Anki mode). */
  reviewedToday: boolean;
  /** Practice grip is high on every kind tried (no need to practise for now). */
  practiceSafe: boolean;
  /** On the page just read / on the next pages of the open text. */
  onPage: boolean;
  onNextPages: boolean;
  /** wordfreq Zipf (0 unknown). */
  zipf: number;
  /** Dismissed as a suggestion. */
  dismissed: boolean;
}

/** Recall band where a word is known enough to retrieve but not yet safe. */
const FRAGILE_LOW = 0.3;
const FRAGILE_HIGH = 0.85;
const SAFE_RECALL = 0.95;

/** How fragile a word is (0..~2.7). */
export function need(s: WordSignals, now: number): number {
  let n =
    s.pKnown >= FRAGILE_LOW && s.pKnown <= FRAGILE_HIGH ? 1 : s.pKnown < FRAGILE_LOW ? 0.5 : 0.15;
  if (s.taps >= 2) n += 0.5;
  if (s.lastTapAt !== undefined && now - s.lastTapAt < 3 * DAY_MS) n += 0.5;
  if (s.lastWrongAt !== undefined && now - s.lastWrongAt < 7 * DAY_MS) n += 0.7;
  return n;
}

/** How worth it a word is now (0.1..~2.2). */
export function use(s: WordSignals): number {
  const freq = Math.min(1, Math.max(0.1, (s.zipf - 2) / 4));
  return freq + (s.onPage ? 0.5 : 0) + (s.onNextPages ? 0.7 : 0);
}

/** Left out of lessons for now. */
export function leftOut(s: WordSignals): boolean {
  return s.state === "ignored" || s.dismissed || s.reviewedToday;
}

/** Safe on every side: kept only as an occasional check (a tenth of its score). */
export function isSafe(s: WordSignals): boolean {
  return s.pKnown >= SAFE_RECALL && s.practiceSafe;
}

/** need × use, with safe words damped. 0 for words left out. */
export function score(s: WordSignals, now: number): number {
  if (leftOut(s)) return 0;
  const v = need(s, now) * use(s);
  return isSafe(s) ? v * 0.1 : v;
}

/**
 * The lesson's words: `due` keys first (in their order, those not left out), then the rest by
 * score, highest first (ties by key, so the result is stable). At most `n` words.
 */
export function pickWords(
  signals: readonly WordSignals[],
  due: readonly string[],
  n: number,
  now: number,
): string[] {
  const byKey = new Map(signals.map((s) => [s.key, s]));
  const out: string[] = [];
  const taken = new Set<string>();
  for (const k of due) {
    if (out.length >= n) return out;
    const s = byKey.get(k);
    if (taken.has(k) || (s && leftOut(s))) continue;
    out.push(k);
    taken.add(k);
  }
  const rest = signals
    .filter((s) => !taken.has(s.key))
    .map((s) => ({ key: s.key, v: score(s, now) }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const x of rest) {
    if (out.length >= n) break;
    out.push(x.key);
  }
  return out;
}
