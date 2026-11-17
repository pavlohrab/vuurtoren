/**
 * AI example sentences: folds SentencesGenerated events into one set per (lang, key, topic).
 * Pure and table-free like conversations.ts, so no schema migration is needed and the local and
 * HTTP repositories answer the same way.
 */
import type { GeneratedSentenceSet, StoredEvent } from "./types.js";

/** Sets in first-generated order; later events for the same (key, topic) append new sentences. */
export function projectGeneratedSentences(events: readonly StoredEvent[]): GeneratedSentenceSet[] {
  const byId = new Map<string, GeneratedSentenceSet>();
  for (const { event: e } of events) {
    if (e.type !== "SentencesGenerated") continue;
    const id = `${e.lang}\u0000${e.key}\u0000${e.topic ?? ""}`;
    let set = byId.get(id);
    if (!set) {
      set = {
        lang: e.lang,
        key: e.key,
        ...(e.topic ? { topic: e.topic } : {}),
        sentences: [],
        rejected: 0,
        provider: e.provider,
        model: e.model,
      };
      byId.set(id, set);
    }
    set.rejected += e.rejected ?? 0;
    for (const s of e.sentences) {
      if (!set.sentences.some((x) => x.text === s.text)) set.sentences.push(s);
    }
  }
  return [...byId.values()];
}
