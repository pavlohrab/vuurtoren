import {
  type AnalyzedToken,
  type LearnerModel,
  classifyTokens,
  containsTerm,
  coverageOf,
  isCounted,
  matchToken,
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

/**
 * Which of `targets` occur in the analysed text, with the reader's matcher (lemma, surface form,
 * alternative lemmas; a separable verb matches on its verb token, whose lemma is the whole verb).
 * Multiword targets must appear in order (`containsTerm`).
 * @returns normalised target key -> the first token that carries it (multiword: its first part)
 */
export function findTargets(
  tokens: readonly AnalyzedToken[],
  targets: readonly string[],
): Map<string, AnalyzedToken> {
  const keys = new Set(targets.map(normalizeKey).filter(Boolean));
  const out = new Map<string, AnalyzedToken>();
  for (const t of tokens) {
    if (!t.is_word || t.particle_of !== null) continue;
    const k = matchToken(t, keys);
    if (k && !out.has(k)) out.set(k, t);
  }
  for (const k of keys) {
    if (out.has(k) || !/\s/.test(k)) continue;
    if (containsTerm([...tokens], k)) {
      const first = normalizeKey(k.split(/\s+/)[0] ?? "");
      const tok = tokens.find((t) => t.is_word && normalizeKey(t.lemma) === first);
      if (tok) out.set(k, tok);
    }
  }
  return out;
}
