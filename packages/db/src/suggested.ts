/**
 * Word suggestions from an assistant (Claude Code over MCP): folds WordSuggested /
 * WordSuggestionDismissed events into the open queue. Table-free like generated.ts, so no
 * schema migration is needed and the local and HTTP repositories answer the same way.
 * Nothing here touches Anki: the learner confirms each word with AddToAnki (ADR 0007).
 */
import type { StoredEvent, SuggestedWord } from "./types.js";

/** Open suggestions, newest first. A later suggestion of a dismissed key opens it again. */
export function projectSuggestedWords(events: readonly StoredEvent[]): SuggestedWord[] {
  const open = new Map<string, SuggestedWord>();
  for (const { id, event: e } of [...events].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const k = `${e.type === "WordSuggested" || e.type === "WordSuggestionDismissed" ? e.lang : ""}\u0000${"key" in e ? e.key : ""}`;
    if (e.type === "WordSuggestionDismissed") open.delete(k);
    else if (e.type === "WordSuggested") {
      open.set(k, {
        lang: e.lang,
        key: e.key,
        word: e.word,
        by: e.by,
        id,
        ...(e.gloss ? { gloss: e.gloss } : {}),
        ...(e.sentence ? { sentence: e.sentence } : {}),
        ...(e.note ? { note: e.note } : {}),
      });
    }
  }
  return [...open.values()].sort((a, b) => (a.id < b.id ? 1 : -1));
}
