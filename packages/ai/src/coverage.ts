import {
  type AnalyzedToken,
  type LearnerModel,
  classifyTokens,
  coverageOf,
  isCounted,
  normalizeKey,
} from "@app/core";

export interface CoverageReport {
  /** Fraction of counted words the learner knows, in [0, 1] (1 when there are no words). */
  coverage: number;
  /** Distinct lemmas (normalised) that are not known well enough, in order of appearance. */
  unknown: string[];
  /** Number of counted word tokens. */
  words: number;
}

/** A word counts as unknown for rewrite purposes below this pKnown. */
const KNOWN_P = 0.5;

/**
 * Coverage of analysed text against the learner model, using the reader's own matcher and
 * counting rules (proper nouns, numbers, ignored words and separable particles do not count).
 * `allowed` lemmas (words the reply intentionally introduces) are treated as known.
 */
export function coverageReport(
  tokens: readonly AnalyzedToken[],
  model: LearnerModel,
  allowed: ReadonlySet<string> = new Set(),
): CoverageReport {
  const planned = classifyTokens(tokens, model).map((p) =>
    p.key !== null && allowed.has(p.key) ? { ...p, pKnown: 1 } : p,
  );
  const unknown: string[] = [];
  const seen = new Set<string>();
  let words = 0;
  planned.forEach((p, k) => {
    const t = tokens[k];
    if (!t || !isCounted(t, p)) return;
    words++;
    const key = p.key ?? normalizeKey(t.lemma);
    if (p.pKnown < KNOWN_P && !seen.has(key)) {
      seen.add(key);
      unknown.push(key);
    }
  });
  return { coverage: coverageOf(planned, tokens), unknown, words };
}
