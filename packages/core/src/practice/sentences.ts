import type { ExampleSentence } from "./types.js";

/** AI sentences rank alongside Tatoeba (same score; callers list them first, input order breaks the tie). */
const SOURCE_RANK: Record<ExampleSentence["source"], number> = {
  anki: 0,
  text: 1,
  ai: 2,
  tatoeba: 2,
};

/** Number of whitespace-separated words. */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** True when `target` is a non-empty, in-range span of `text`. */
function validSpan(s: ExampleSentence): boolean {
  const [a, b] = s.target;
  return Number.isInteger(a) && Number.isInteger(b) && a >= 0 && a < b && b <= s.text.length;
}

/**
 * Rank usable sentences, best first: a sentence whose length is within [minWords, maxWords]
 * always beats one outside it; ties break by source (anki, text, then ai and tatoeba alike) and then input order.
 */
export function rankSentences(
  sentences: readonly ExampleSentence[],
  minWords = 5,
  maxWords = 15,
): ExampleSentence[] {
  const score = (s: ExampleSentence) => {
    const n = wordCount(s.text);
    // Unknown words weigh more than length or source (lessons set `unknown`, 4.7.4).
    return (
      (n >= minWords && n <= maxWords ? 0 : 3) +
      SOURCE_RANK[s.source] +
      4 * (s.unknown ?? 0) -
      (s.first ? 2 : 0)
    );
  };
  return sentences
    .filter(validSpan)
    .map((s, i) => ({ s, i }))
    .sort((x, y) => score(x.s) - score(y.s) || x.i - y.i)
    .map((x) => x.s);
}

/** The text covered by the sentence's target span. */
export function targetSurface(s: ExampleSentence): string {
  return s.text.slice(s.target[0], s.target[1]);
}
