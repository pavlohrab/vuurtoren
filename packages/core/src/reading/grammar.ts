/**
 * Grammar hits: constructions found by the NLP service's rule-based detectors
 * (server/nlp/src/vuurtoren_nlp/grammar.py, `POST /grammar`), stored per text by packages/db and
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

/** A short note on a sentence's word order, from one of its grammar hits. */
export interface OrderNote {
  /** Detector topic id of the hit. */
  topic: string;
  /** Short name of the pattern ("Verb second"). */
  label: string;
  /** One plain-English line about this sentence. */
  note: string;
  /** The words the note is about (token indices). */
  tokens: number[];
}

/** Word-order topics, the most telling first, with the pattern's short name. */
const ORDER_TOPICS: [topic: string, label: string][] = [
  ["subordinate-clauses", "Verb at the end"],
  ["relative-pronouns", "Verb at the end"],
  ["separable-verbs", "Separable verb split"],
  ["perfect-tense", "Participle at the end"],
  ["inversion", "Verb second"],
];

/**
 * The word-order note of sentence `sent` for the side-by-side structure view: verb at the end
 * after a subordinator or in a relative clause, a split separable verb, a participle at the
 * end, or verb second (inversion). Null when the detectors found none of these. Uses the
 * detector's own note; a perfect tense gets one about where the participle goes.
 */
export function wordOrderNote(
  hits: readonly GrammarHit[],
  sent: number,
  tokens: readonly { text: string }[],
): OrderNote | null {
  const inSentence = hitsInSentence(hits, sent);
  for (const [topic, label] of ORDER_TOPICS) {
    const hit = inSentence.find((h) => h.topic === topic);
    if (!hit) continue;
    let note = hit.note;
    if (topic === "perfect-tense") {
      const [aux, part] = hit.tokens.map((i) => tokens[i]?.text);
      if (aux && part) note = `«${aux}» comes early and the participle «${part}» goes to the end.`;
    }
    return { topic, label, note, tokens: [...hit.tokens] };
  }
  return null;
}
