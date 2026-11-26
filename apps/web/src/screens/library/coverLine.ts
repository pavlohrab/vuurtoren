/**
 * The line under a cover (F5, mock MK3 A): "about A2 · 12 new words", "about A2" when nothing is
 * new, "12 new words" when there is no level, null when there is neither.
 */
export function coverLine(
  level: string | null | undefined,
  newWords: number | null | undefined,
): string | null {
  const parts = coverLines(level, newWords);
  return parts.length ? parts.join(" · ") : null;
}

/** The same, one part per line, as the shelves show it (it fits under a phone's cover). */
export function coverLines(
  level: string | null | undefined,
  newWords: number | null | undefined,
): string[] {
  return [
    level ? `about ${level}` : null,
    newWords ? `${newWords} new ${newWords === 1 ? "word" : "words"}` : null,
  ].filter((x): x is string => !!x);
}

/** The pair palette (the side by side colours), for story covers: one per story, always the same. */
const STORY_HUES = 8;

/** A cover's colour, picked from its slug or id so it stays the same everywhere. */
export function storyHue(slug: string): string {
  let h = 0;
  for (const c of slug) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `var(--pair-hue-${(h % STORY_HUES) + 1})`;
}

/** Your texts' colours as deep covers: the pair palette without yellow and slate (muddy dark). */
const TEXT_HUES = [1, 2, 3, 4, 5, 6, 8];

/** A text's cover colour, picked from its id so it stays the same everywhere. */
export function textHue(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `var(--pair-hue-${TEXT_HUES[h % TEXT_HUES.length]})`;
}
