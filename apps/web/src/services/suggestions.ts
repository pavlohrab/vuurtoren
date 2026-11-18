import type { SuggestedWord } from "@app/db";
import type { InspectorEntry } from "@app/core";

/** Inspector entry for a suggestion: Claude's gloss and sentence first. */
export function suggestionEntry(base: InspectorEntry, s: SuggestedWord): InspectorEntry {
  const art = /^(de|het)\s+/i.exec(s.word)?.[1]?.toLowerCase();
  const sentence = s.sentence ?? base.sentence;
  const at = sentence.toLocaleLowerCase().indexOf(s.key.toLocaleLowerCase());
  return {
    ...base,
    glosses: s.gloss ? [s.gloss, ...base.glosses.filter((g) => g !== s.gloss)] : base.glosses,
    sentence,
    sentenceHighlight: at >= 0 ? [at, at + s.key.length] : [0, 0],
    ...(art ? { article: art, pos: "NOUN" } : {}),
  };
}
