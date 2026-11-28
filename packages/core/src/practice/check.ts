import type { Exercise } from "./types.js";

/** NFC + trim + collapse inner whitespace + lowercase. */
export function normalizeAnswer(s: string): string {
  return s.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Remove combining marks (één -> een). */
export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");
}

/** Curly apostrophes / quotes to their ASCII forms. */
function normalizeQuotes(s: string): string {
  return s
    .replace(/[\u2018\u2019\u02bc`´]/g, "'")
    .replace(/[\u201c\u201d\u201e\u00ab\u00bb]/g, '"');
}

/** Word answers: drop leading/trailing punctuation ("loopt." -> "loopt"). */
function stripEdgePunctuation(s: string): string {
  return s.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

/** Sentence answers: drop all punctuation except in-word apostrophes and hyphens. */
function stripSentencePunctuation(s: string): string {
  return s
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/(^|\s)['-]+|['-]+(?=\s|$)/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Check a learner's answer.
 * - Choice exercises (`choices`): exact match with the answer (after NFC + trim).
 * - Scramble (`pieces`) and dictation: case-insensitive, all punctuation ignored (in-word apostrophes and hyphens kept).
 * - Other typed exercises: case-insensitive; `answer` and `accept` are valid;
 *   a missing diacritic is still correct but comes with a note ("Mind the accents: één").
 */
export function checkAnswer(
  exercise: Exercise,
  answer: string,
): { correct: boolean; note?: string } {
  if (exercise.choices) {
    return { correct: answer.normalize("NFC").trim() === exercise.answer.normalize("NFC") };
  }
  if (exercise.kind === "say") return checkSaid(exercise.answer, answer);
  if (exercise.kind === "write") return checkWritten(exercise.answer, answer);
  const sentenceLevel = exercise.pieces !== undefined || exercise.kind === "dictation";
  const norm = (s: string) => {
    const n = normalizeAnswer(normalizeQuotes(s));
    return sentenceLevel ? stripSentencePunctuation(n) : stripEdgePunctuation(n);
  };
  const given = norm(answer);
  if (given === "") return { correct: false };
  const accepted = [exercise.answer, ...(exercise.accept ?? [])];
  if (accepted.some((a) => norm(a) === given)) return { correct: true };
  const hit = accepted.find((a) => stripAccents(norm(a)) === stripAccents(given));
  if (hit !== undefined) return { correct: true, note: `Mind the accents: ${hit}` };
  return { correct: false };
}

/**
 * "Write it": the word with its article ("de fiets"). Without the article, or with the other
 * one, it still counts, with the right one as a note.
 */
function checkWritten(expected: string, answer: string): { correct: boolean; note?: string } {
  const norm = (s: string) => stripEdgePunctuation(normalizeAnswer(normalizeQuotes(s)));
  const bare = (s: string) => s.replace(/^(de|het)\s+/, "");
  const [want, given] = [norm(expected), norm(answer)];
  if (!given) return { correct: false };
  if (want === given) return { correct: true };
  const withAccents = stripAccents(want) === stripAccents(given);
  if (withAccents) return { correct: true, note: `Mind the accents: ${expected}` };
  if (bare(want) !== want && stripAccents(bare(want)) === stripAccents(bare(given)))
    return { correct: true, note: `With its article: ${expected}` };
  return { correct: false };
}

/** Share of the sentence's words that must come through for "say" to count (speech recognition
 * mishears some Dutch, so this is lenient; the learner can still say it was right). */
const SAY_ENOUGH = 0.7;

const sayWords = (s: string) =>
  stripAccents(stripSentencePunctuation(normalizeAnswer(normalizeQuotes(s))))
    .split(" ")
    .filter(Boolean);

/** Two words sound alike enough: equal, or one letter apart in words of 4+ letters. */
function close(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  const rest = (x: string, y: string) => x === y;
  return (
    rest(a.slice(i + 1), b.slice(i + 1)) ||
    rest(a.slice(i + 1), b.slice(i)) ||
    rest(a.slice(i), b.slice(i + 1))
  );
}

/** The sentence's words that were heard, in order (longest common subsequence, with `close`). */
export function heardWords(sentence: string, heard: string): boolean[] {
  const a = sayWords(sentence);
  const b = sayWords(heard);
  const t = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      t[i]![j] = close(a[i]!, b[j]!)
        ? 1 + t[i + 1]![j + 1]!
        : Math.max(t[i + 1]![j]!, t[i]![j + 1]!);
  const out = new Array<boolean>(a.length).fill(false);
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (close(a[i]!, b[j]!)) {
      out[i] = true;
      i++;
      j++;
    } else if (t[i + 1]![j]! >= t[i]![j + 1]!) i++;
    else j++;
  }
  return out;
}

/** "say": right when enough of the sentence's words were heard. */
function checkSaid(sentence: string, heard: string): { correct: boolean; note?: string } {
  const hits = heardWords(sentence, heard);
  if (!hits.length || !heard.trim()) return { correct: false };
  const share = hits.filter(Boolean).length / hits.length;
  return share >= SAY_ENOUGH
    ? { correct: true, ...(share < 1 ? { note: `Heard: ${heard}` } : {}) }
    : { correct: false, note: `Heard: ${heard}` };
}
