/** Checking answers to book-exercise items (pure). */
import { normalizeAnswer, stripAccents } from "../practice/check.js";
import type { ParseToken } from "./derive.js";
import { normalizeKey } from "../match.js";
import type { ExerciseItem, ExerciseType } from "./types.js";

/** Result of checking one item; `correct` is null when the book gave no answer to compare with. */
export interface ItemCheck {
  correct: boolean | null;
  /** Message such as an accent reminder or "different order, but a valid sentence". */
  note?: string;
}

const stripFinal = (s: string) => s.replace(/[\s.!?…]+$/u, "");
const wordsOf = (s: string): string[] =>
  normalizeAnswer(stripFinal(s))
    .split(/[^\p{L}\p{N}'’]+/u)
    .filter(Boolean)
    .sort();

/** True when both sentences use exactly the same words (any order, case and final punctuation ignored). */
function sameWords(a: string, b: string): boolean {
  const x = wordsOf(a);
  const y = wordsOf(b);
  return x.length === y.length && x.every((w, i) => w === y[i]);
}

/**
 * Verb-second test on a parse: the finite verb (ROOT) must be preceded by exactly one
 * constituent (all earlier words hang from one dependent of the verb). Used to accept other valid
 * main-clause orders when building sentences.
 */
export function isVerbSecond(tokens: readonly ParseToken[]): boolean {
  const word = tokens.filter((t) => t.is_word);
  const root = word.find((t) => t.head === t.i);
  if (!root || !/VerbForm=Fin/.test(root.morph)) return false;
  const byIndex = new Map(tokens.map((t) => [t.i, t]));
  const top = (t: ParseToken): number => {
    let cur = t;
    for (let guard = 0; guard < 50 && cur.head !== root.i && cur.head !== cur.i; guard++) {
      const next = byIndex.get(cur.head);
      if (!next) break;
      cur = next;
    }
    return cur.i;
  };
  const before = word.filter((t) => t.start < root.start);
  return before.length > 0 && new Set(before.map(top)).size === 1;
}

/** Split an answer string of a multi-blank item ("woont|werkt"). */
const parts = (s: string) => s.split("|").map((p) => p.trim());

/**
 * Check one answer.
 * @param orderOk for sentence building: the caller's verb-second verdict on the answer (parse), or undefined
 */
export function checkBookItem(
  type: ExerciseType,
  item: ExerciseItem,
  answer: string,
  orderOk?: boolean,
): ItemCheck {
  const given = normalizeAnswer(answer);
  if (!given) return { correct: false };
  if (item.answer === undefined) return { correct: null };
  if (type === "sentence-building") {
    const accepted = [item.answer, ...(item.accept ?? [])];
    if (
      accepted.some((a) => normalizeAnswer(stripFinal(a)) === normalizeAnswer(stripFinal(answer)))
    ) {
      return { correct: true };
    }
    if (orderOk && sameWords(item.answer, answer)) {
      return { correct: true, note: "A different order, also correct." };
    }
    return { correct: false };
  }
  // Multi-blank answers are compared blank by blank.
  const wanted = [item.answer, ...(item.accept ?? [])].map(parts);
  const got = parts(answer);
  const exact = wanted.some(
    (w) =>
      w.length === got.length &&
      w.every((x, i) => normalizeAnswer(x) === normalizeAnswer(got[i] ?? "")),
  );
  if (exact) return { correct: true };
  const lenient = wanted.find(
    (w) =>
      w.length === got.length &&
      w.every(
        (x, i) => stripAccents(normalizeAnswer(x)) === stripAccents(normalizeAnswer(got[i] ?? "")),
      ),
  );
  return lenient
    ? { correct: true, note: `Mind the accents: ${lenient.join(", ")}` }
    : { correct: false };
}

/** Exercise types whose items test vocabulary (sentence building tests word order). */
const WORD_TYPES: ReadonlySet<ExerciseType> = new Set([
  "gapfill",
  "conjugation-table",
  "choice",
  "matching",
]);

/**
 * The learner-model keys a book exercise item tests, so its answer can feed those words' app
 * evidence (ADR 0011). The bracketed hint (usually the lemma, "(lopen)") wins; otherwise the
 * words of the expected answer that `isWord` recognises (unit words or the learner model).
 * At most three keys; none for sentence building, open tasks and listening.
 */
export function bookItemKeys(
  type: ExerciseType,
  item: ExerciseItem,
  isWord: (key: string) => boolean,
): string[] {
  if (!WORD_TYPES.has(type)) return [];
  const words = (s: string | undefined) =>
    (s ?? "")
      .split(/[^\p{L}'-]+/u)
      .map((w) => normalizeKey(w))
      .filter(Boolean);
  const hint = item.hint ? normalizeKey(item.hint.replace(/[()[\]]/g, "")) : "";
  if (hint && (isWord(hint) || words(hint).length === 1)) return [hint];
  const out: string[] = [];
  for (const w of words(item.answer)) if (isWord(w) && !out.includes(w)) out.push(w);
  return out.slice(0, 3);
}
