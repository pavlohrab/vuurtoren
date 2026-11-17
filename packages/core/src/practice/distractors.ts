import { shuffle, type Rng } from "./rng.js";
import type { WordData } from "./types.js";

/** Widest Zipf difference tried when the ±1 band holds too few candidates. */
const MAX_BAND = 8;

const firstGloss = (w: WordData): string | undefined => w.glosses[0];
const lc = (s: string) => s.toLowerCase();
const isFamiliar = (w: WordData) => w.state === "known" || w.state === "learning";

/**
 * Pick `n` wrong options for `word` from `pool`.
 * Candidates share the POS, are never the word itself or a synonym (same first gloss),
 * lie within Zipf ±1 (widened stepwise until there are enough), and prefer words the
 * learner knows so that options are recognisable. Duplicates (case-insensitive) are removed.
 * `by: "lemma"` returns lemmas, `by: "gloss"` returns each candidate's first gloss.
 * Returns fewer than `n` if the pool is too small.
 */
export function distractors(
  word: WordData,
  pool: readonly WordData[],
  n: number,
  rng: Rng,
  by: "lemma" | "gloss" = "lemma",
): string[] {
  const ownGlosses = new Set(word.glosses.map(lc));
  const output = (w: WordData): string | undefined => (by === "gloss" ? firstGloss(w) : w.lemma);

  // Eligible candidates with their output string, deduplicated by that string.
  const seen = new Set<string>([lc(output(word) ?? word.lemma), lc(word.lemma)]);
  const eligible: { w: WordData; out: string }[] = [];
  for (const w of shuffle(pool, rng)) {
    const out = output(w);
    const gloss = firstGloss(w);
    if (out === undefined || out === "" || w.pos !== word.pos || w.key === word.key) continue;
    if (lc(w.lemma) === lc(word.lemma)) continue;
    if (gloss !== undefined && ownGlosses.has(lc(gloss))) continue; // synonym
    if (seen.has(lc(out))) continue;
    seen.add(lc(out));
    eligible.push({ w, out });
  }

  let band = 1;
  while (band < MAX_BAND && eligible.filter((c) => inBand(c.w, word, band)).length < n) band++;
  const inRange = eligible.filter((c) => inBand(c.w, word, band));
  const familiar = inRange.filter((c) => isFamiliar(c.w));
  const others = inRange.filter((c) => !isFamiliar(c.w));
  return [...familiar, ...others].slice(0, n).map((c) => c.out);
}

function inBand(candidate: WordData, word: WordData, band: number): boolean {
  return Math.abs(candidate.zipf - word.zipf) <= band;
}
