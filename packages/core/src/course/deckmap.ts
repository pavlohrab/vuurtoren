/**
 * Fuzzy mapping of course units to Anki deck names, e.g. unit "Thema 3 Boodschappen doen en
 * winkelen" <-> deck "De Opmaat A2::Thema 03 - Winkelen". The user confirms the result once.
 */
import type { Unit } from "./types.js";
import { UNIT_WORDS } from "./vocab.js";

/** Words that carry no meaning for matching titles. */
const STOP = new Set([
  "de",
  "het",
  "een",
  "en",
  "van",
  "in",
  "op",
  "te",
  "om",
  "voor",
  "met",
  "aan",
  "bij",
  ...UNIT_WORDS.map((w) => fold(w)),
  "deck",
  "anki",
  "nl",
]);

/** Lowercase, strip accents and punctuation. */
function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ");
}

const UNIT_NUMBER_RE = new RegExp(
  `(?:${[...new Set(UNIT_WORDS.map((w) => fold(w)))].join("|")})\\s*0*(\\d{1,3})(?!\\d)`,
  "u",
);

/** Unit/deck number: the first integer that follows a unit word, else the first integer. */
export function extractNumber(s: string): number | null {
  const f = fold(s);
  const m = UNIT_NUMBER_RE.exec(f) ?? /(?<![\p{L}\d])0*(\d{1,3})(?!\d)/u.exec(f);
  return m ? Number(m[1]) : null;
}

/** Meaningful lowercase words of a title (stop words and numbers removed). */
export function titleWords(s: string): string[] {
  return fold(s)
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
}

/** Common-prefix similarity of two words in [0, 1]: "winkelen" ~ "winkel", "boodschappen" ~ "boodschap". */
function wordSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return n >= 4 && i >= 4 && i >= n - 2 ? i / Math.max(a.length, b.length) + 0.2 : 0;
}

/** Score in [0, 1] of how well `deck` fits `unit` (0 = unrelated). */
export function deckScore(unit: Pick<Unit, "title" | "n">, deck: string): number {
  // Only the deck's leaf matters ("Course::Thema 03 - Winkelen"); for "Course::Unit 3::Words"
  // the deepest level that names a number.
  const levels = deck.split("::");
  const leaf =
    [...levels].reverse().find((l, i) => i < 2 && extractNumber(l) !== null) ??
    levels[levels.length - 1] ??
    deck;
  const uNum = extractNumber(unit.title) ?? unit.n;
  const dNum = extractNumber(leaf);
  const uw = titleWords(unit.title);
  const dw = titleWords(leaf);
  let overlap = 0;
  for (const w of dw) overlap = Math.max(overlap, ...uw.map((x) => wordSimilarity(w, x)));
  const shared =
    dw.length === 0 || uw.length === 0
      ? 0
      : dw.reduce((s, w) => s + Math.max(0, ...uw.map((x) => wordSimilarity(w, x))), 0) / dw.length;
  const numberMatch = dNum !== null && uNum !== null && dNum === uNum;
  const numberClash = dNum !== null && uNum !== null && dNum !== uNum;
  if (numberClash) return 0;
  return Math.min(1, (numberMatch ? 0.6 : 0) + 0.4 * Math.max(shared, overlap * 0.8));
}

export interface DeckSuggestion {
  n: number;
  decks: string[];
  /** Best score that produced the suggestion (0 when none). */
  score: number;
}

/**
 * Suggest decks per unit: every deck scoring at least `min` for the unit and not better for
 * another unit. Units without a decent match get an empty list. Pure.
 */
export function suggestDecks(
  units: readonly Pick<Unit, "title" | "n">[],
  decks: readonly string[],
  min = 0.5,
): DeckSuggestion[] {
  const best = new Map<string, { n: number; score: number }>();
  for (const deck of decks) {
    for (const u of units) {
      const score = deckScore(u, deck);
      const cur = best.get(deck);
      if (score >= min && (!cur || score > cur.score)) best.set(deck, { n: u.n, score });
    }
  }
  return units.map((u) => {
    const mine = [...best].filter(([, b]) => b.n === u.n);
    return {
      n: u.n,
      decks: mine.map(([d]) => d).sort(),
      score: Math.max(0, ...mine.map(([, b]) => b.score)),
    };
  });
}
