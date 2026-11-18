/**
 * Which grammar the reader points out (docs/research/09-reader-annotations.md).
 *
 * Margin marks: at most one quiet mark per sentence, for the topic the learner should notice
 * most (at or just above their level, the course unit's topics, topics they practise), and
 * never in two neighbouring sentences, so a page has at most one mark per two sentences.
 * Very common constructions (V2, de/het, plurals…) are never marked in the margin; they can be
 * shown with the focus picker.
 */
import {
  CEFR_LEVELS,
  type CefrLevel,
  type GrammarTopic,
  curriculum,
  topicForHit,
} from "@app/content";
import type { GrammarHit } from "@app/core";

/** Detector topics that occur in nearly every sentence: focus mode only, never a margin mark. */
export const FOCUS_ONLY = new Set([
  "inversion",
  "questions",
  "negation",
  "plural-nouns",
  "diminutives",
  "demonstratives",
  "conjunctions",
  "perfect-tense",
  "imperfect-tense",
  "modal-verbs",
  "object-pronouns",
  "adjective-inflection",
]);

/** Rough CEFR level from the estimated vocabulary (known word families). */
export function levelFromVocabulary(words: number | null | undefined): CefrLevel {
  if (!words) return "A2";
  if (words < 600) return "A1";
  if (words < 1500) return "A2";
  if (words < 3000) return "B1";
  if (words < 6000) return "B2";
  return "C1";
}

export interface MarkContext {
  level: CefrLevel;
  /** Topic page ids of the current course unit. */
  unitTopics?: ReadonlySet<string>;
  /** Topic page ids the learner focused on or practised recently. */
  recentTopics?: ReadonlySet<string>;
}

/** How much a topic is worth pointing out to this learner (0 = not at all). */
export function topicPriority(topic: GrammarTopic, ctx: MarkContext): number {
  const d = CEFR_LEVELS.indexOf(topic.level) - CEFR_LEVELS.indexOf(ctx.level);
  let score = d === 0 ? 3 : d === 1 ? 2.5 : d === -1 ? 1.5 : d === 2 ? 0.75 : 0;
  if (ctx.unitTopics?.has(topic.id)) score += 3;
  if (ctx.recentTopics?.has(topic.id)) score += 2;
  return score;
}

export interface MarginMark {
  sent: number;
  topic: GrammarTopic;
  /** The hits of this topic in the sentence (what the open mark underlines). */
  hits: GrammarHit[];
}

/**
 * Margin marks for `hits` (any order). `sentences` limits the result to those sentence numbers
 * (the current page); the density rule is applied within them.
 */
export function marginMarks(
  hits: readonly GrammarHit[],
  ctx: MarkContext,
  sentences?: ReadonlySet<number>,
): Map<number, MarginMark> {
  const order = new Map(curriculum().map((t, k) => [t.id, k]));
  // Best topic per sentence.
  const best = new Map<number, { mark: MarginMark; score: number }>();
  for (const h of hits) {
    if (FOCUS_ONLY.has(h.topic) || (sentences && !sentences.has(h.sent))) continue;
    const topic = topicForHit(h.topic);
    if (!topic) continue;
    const score = topicPriority(topic, ctx);
    if (score < 1) continue;
    const cur = best.get(h.sent);
    if (cur && cur.mark.topic.id === topic.id) {
      cur.mark.hits.push(h);
      continue;
    }
    const better =
      !cur ||
      score > cur.score ||
      (score === cur.score && (order.get(topic.id) ?? 0) < (order.get(cur.mark.topic.id) ?? 0));
    if (better) best.set(h.sent, { mark: { sent: h.sent, topic, hits: [h] }, score });
  }
  // Density: strongest first, never two neighbouring sentences.
  const ranked = [...best.values()].sort((a, b) => b.score - a.score || a.mark.sent - b.mark.sent);
  const out = new Map<number, MarginMark>();
  for (const { mark } of ranked) {
    if (out.has(mark.sent - 1) || out.has(mark.sent + 1)) continue;
    out.set(mark.sent, mark);
  }
  return new Map([...out].sort((a, b) => a[0] - b[0]));
}

/** The hits a topic page covers (every detector it lists), in text order. */
export function hitsForTopic(hits: readonly GrammarHit[], topic: GrammarTopic): GrammarHit[] {
  return hits.filter((h) => topic.detects.includes(h.topic));
}

/** Topic pages with hits in the text, with their counts, in curriculum order. */
export function topicsInText(
  hits: readonly GrammarHit[],
): { topic: GrammarTopic; count: number }[] {
  return curriculum()
    .map((topic) => ({ topic, count: hitsForTopic(hits, topic).length }))
    .filter((t) => t.count > 0);
}

const RECENT_KEY = "kenning-grammar-recent";

/** Topic ids the learner focused on recently (newest first; [] when storage is unavailable). */
export function readRecentTopics(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Remember a topic the learner chose to focus on or practise (keeps the last eight). */
export function noteRecentTopic(id: string): void {
  try {
    const next = [id, ...readRecentTopics().filter((x) => x !== id)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: suggestions just ignore recent topics */
  }
}
