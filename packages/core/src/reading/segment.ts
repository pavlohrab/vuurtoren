/**
 * Splitting an analysed text into reading segments (~150 word tokens) that never cut a sentence.
 */
import type { AnalyzedToken, Segment } from "./types.js";

/** Default segment size in word tokens. */
const DEFAULT_SEGMENT_WORDS = 150;

/** Fractions of the target used by the cut heuristics. */
const PARAGRAPH_CUT_FRACTION = 0.67; // cut at a paragraph break once a segment is this full
const MIN_FILL_FRACTION = 0.5; // never cut early before this fill
const OVERSHOOT_FRACTION = 1.33; // avoid adding a sentence that overshoots the target this much

interface Sentence {
  start: number; // token array index, inclusive
  end: number; // exclusive
  words: number;
}

/** Group tokens into runs of equal `sent` (token array positions). */
function splitSentences(tokens: readonly AnalyzedToken[]): Sentence[] {
  const out: Sentence[] = [];
  let cur: Sentence | undefined;
  tokens.forEach((t, k) => {
    if (!cur || t.sent !== tokens[cur.start]!.sent) {
      cur = { start: k, end: k, words: 0 };
      out.push(cur);
    }
    cur.end = k + 1;
    if (t.is_word) cur.words++;
  });
  return out;
}

/** True if the source text between the last word of `prev` and the first word of `next` has a blank line. */
function paragraphBreak(
  tokens: readonly AnalyzedToken[],
  prev: Sentence,
  next: Sentence,
  text: string | undefined,
): boolean {
  if (text === undefined) return false;
  let from = -1;
  for (let k = prev.end - 1; k >= prev.start; k--) {
    if (tokens[k]!.is_word) {
      from = tokens[k]!.end;
      break;
    }
  }
  let to = -1;
  for (let k = next.start; k < next.end; k++) {
    if (tokens[k]!.is_word) {
      to = tokens[k]!.start;
      break;
    }
  }
  if (from < 0 || to < from) return false;
  return text.slice(from, to).includes("\n\n");
}

/**
 * Split tokens into consecutive segments of roughly `targetWords` word tokens.
 *
 * Cuts only happen at sentence boundaries, so a very long sentence becomes (part of) one
 * segment. When `text` is given, cuts prefer paragraph breaks (a "\n\n" between words)
 * once a segment is about two thirds full.
 *
 * @param tokens analysed tokens in text order
 * @param targetWords desired words per segment (default 150)
 * @param text optional source text, used to detect paragraph breaks
 * @returns segments covering all tokens; `[]` for empty input
 * @throws RangeError if targetWords is not a positive number
 */
export function segmentTokens(
  tokens: readonly AnalyzedToken[],
  targetWords: number = DEFAULT_SEGMENT_WORDS,
  text?: string,
): Segment[] {
  if (!(targetWords > 0)) throw new RangeError("targetWords must be positive");
  if (!tokens.length) return [];

  const sentences = splitSentences(tokens);
  const groups: Sentence[][] = [[]];
  let count = 0;
  let prev: Sentence | undefined;

  for (const s of sentences) {
    const group = groups[groups.length - 1]!;
    if (prev && group.length) {
      const full = count >= targetWords;
      const overshoot =
        count + s.words > targetWords * OVERSHOOT_FRACTION &&
        count >= targetWords * MIN_FILL_FRACTION;
      const paragraph =
        count >= targetWords * PARAGRAPH_CUT_FRACTION && paragraphBreak(tokens, prev, s, text);
      if (full || overshoot || paragraph) {
        groups.push([]);
        count = 0;
      }
    }
    groups[groups.length - 1]!.push(s);
    count += s.words;
    prev = s;
  }

  return groups.map((g, index) => {
    const tokenStart = g[0]!.start;
    const tokenEnd = g[g.length - 1]!.end;
    return {
      index,
      tokenStart,
      tokenEnd,
      charStart: tokens[tokenStart]!.start,
      charEnd: tokens[tokenEnd - 1]!.end,
    };
  });
}
