/** Test helpers: a tiny tokenizer producing AnalyzedToken fixtures, and model builders. */
import type { LearnerModel } from "../learner.js";
import type { WordKnowledge } from "../memory.js";
import type { AnalyzedToken } from "./types.js";

/** Per-word overrides, keyed by lowercase surface form. */
export type Overrides = Record<string, Partial<AnalyzedToken>>;

/**
 * Tokenise `text` into fixtures: words/numbers/punctuation, `sent` increments after . ! ?,
 * lemma = lowercase surface, zipf defaults to 5. Offsets index into `text`.
 */
export function tokenize(text: string, overrides: Overrides = {}): AnalyzedToken[] {
  const out: AnalyzedToken[] = [];
  let sent = 0;
  let pendingBreak = false;
  for (const m of text.matchAll(/\p{L}+|\d+|[^\s\p{L}\d]/gu)) {
    const surface = m[0];
    const isNum = /^\d+$/.test(surface);
    const isWord = isNum || /^\p{L}/u.test(surface);
    if (pendingBreak && isWord) {
      sent++;
      pendingBreak = false;
    }
    const start = m.index ?? 0;
    out.push({
      i: out.length,
      text: surface,
      lemma: surface.toLowerCase(),
      alt_lemmas: [],
      pos: isWord ? "X" : "PUNCT",
      morph: "",
      dep: "",
      head: 0,
      sent,
      start,
      end: start + surface.length,
      is_word: isWord,
      is_propn: false,
      is_num: isNum,
      particle_of: null,
      zipf: 5,
      ...overrides[surface.toLowerCase()],
    });
    if (/^[.!?]$/.test(surface)) pendingBreak = true;
  }
  return out;
}

/** Letters-only unique word for index n ("qa", "qb", ... "qba"), safe for the tokenizer. */
function fillerWord(n: number): string {
  let s = "";
  let x = n;
  do {
    s = String.fromCharCode(97 + (x % 26)) + s;
    x = Math.floor(x / 26);
  } while (x > 0);
  return `q${s}`;
}

/** `sentences` sentences of `wordsPerSentence` distinct filler words each, joined by `sep`. */
export function filler(sentences: number, wordsPerSentence: number, sep = " "): string {
  let n = 0;
  return Array.from({ length: sentences }, () =>
    Array.from({ length: wordsPerSentence }, () => fillerWord(n++)).join(" "),
  )
    .map((s) => `${s}.`)
    .join(sep);
}

export function model(entries: Record<string, WordKnowledge>): LearnerModel {
  return new Map(Object.entries(entries));
}

export const known = (pKnown = 0.95): WordKnowledge => ({ state: "known", pKnown });
export const learning = (pKnown = 0.8): WordKnowledge => ({ state: "learning", pKnown });
