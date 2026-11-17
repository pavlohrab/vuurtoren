/**
 * Grammar hits (M5): constructions found by the NLP service's rule-based detectors
 * (server/nlp/src/kenning_nlp/grammar.py, `POST /grammar`), stored per text by packages/db and
 * shown as reader spotlights. The topic ids name grammar pages in packages/content.
 */

/** One detected construction. Offsets and indices refer to the whole text and its analysis. */
export interface GrammarHit {
  /** Detector topic id, e.g. "inversion" (see `topicForHit` in @app/content for its page). */
  topic: string;
  /** Token indices (`AnalyzedToken.i`) of the words that make up the construction. */
  tokens: number[];
  /** Sentence number (`AnalyzedToken.sent`). */
  sent: number;
  /** [start, end) of the sentence in the text (UTF-16 code units, like token offsets). */
  start: number;
  end: number;
  /** One short plain-English line about this occurrence. */
  note: string;
}

/**
 * Spotlight map for the reader: token index -> topic ids of the hits it belongs to (each topic
 * once, in hit order). With `only`, other topics are left out.
 */
export function spotlightTokens(
  hits: readonly GrammarHit[],
  only?: ReadonlySet<string>,
): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const h of hits) {
    if (only && !only.has(h.topic)) continue;
    for (const i of h.tokens) {
      const list = out.get(i);
      if (!list) out.set(i, [h.topic]);
      else if (!list.includes(h.topic)) list.push(h.topic);
    }
  }
  return out;
}

/** The hits a token takes part in (what the inspector shows for a clicked word). */
export function hitsAtToken(hits: readonly GrammarHit[], token: number): GrammarHit[] {
  return hits.filter((h) => h.tokens.includes(token));
}

/** All hits of one sentence, in order (context for "Explain this sentence"). */
export function hitsInSentence(hits: readonly GrammarHit[], sent: number): GrammarHit[] {
  return hits.filter((h) => h.sent === sent);
}

/** Number of hits per topic id. */
export function countHits(hits: readonly GrammarHit[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const h of hits) out[h.topic] = (out[h.topic] ?? 0) + 1;
  return out;
}
