import type { GrammarHit } from "@app/core";
import { type GrammarTopic, topicForHit } from "@app/content";
import "./grammar.css";

/** The hits of one token, one entry per topic page (first note wins). */
export function notesFor(hits: readonly GrammarHit[]): { topic: GrammarTopic; note: string }[] {
  const out: { topic: GrammarTopic; note: string }[] = [];
  for (const h of hits) {
    const topic = topicForHit(h.topic);
    if (topic && !out.some((o) => o.topic.id === topic.id)) out.push({ topic, note: h.note });
  }
  return out;
}

/** Spotlight label for a token: the titles of its topics ("Inversion · Separable verbs"). */
export function spotlightLabel(detectors: readonly string[]): string {
  const titles: string[] = [];
  for (const d of detectors) {
    const title = topicForHit(d)?.title;
    if (title && !titles.includes(title)) titles.push(title);
  }
  return titles.join(" · ");
}
