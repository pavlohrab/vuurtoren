/**
 * How common a word is, in words (LV9): from its Zipf frequency (wordfreq, frozen data, so the
 * same word always gets the same label). Shown beside NT2Lex's level, never mixed with it:
 * frequency can't predict that level (notes/levels.md, 25 Nov).
 *
 * Zipf 5 is about once in 100,000 words, 3 once in a million.
 */
export function frequencyLabel(zipf: number | undefined): string | null {
  if (zipf === undefined || !(zipf > 0)) return null;
  if (zipf >= 5) return "very common";
  if (zipf >= 4) return "common";
  if (zipf >= 3) return "less common";
  return "rare";
}
