import type { GrammarHit } from "@app/core";
import { type GrammarTopic, topicForHit } from "@app/content";
import "./grammar/grammar.css";

/** The hits of one token, one entry per topic page (first note wins). */
export function notesFor(hits: readonly GrammarHit[]): { topic: GrammarTopic; note: string }[] {
  const out: { topic: GrammarTopic; note: string }[] = [];
  for (const h of hits) {
    const topic = topicForHit(h.topic);
    if (topic && !out.some((o) => o.topic.id === topic.id)) out.push({ topic, note: h.note });
  }
  return out;
}
