/**
 * The line under a cover (F5, mock MK3 A): "about A2 · 12 new words", "about A2" when nothing is
 * new, "12 new words" when there is no level, null when there is neither.
 */
export function coverLine(
  level: string | null | undefined,
  newWords: number | null | undefined,
): string | null {
  const parts = [
    level ? `about ${level}` : null,
    newWords ? `${newWords} new ${newWords === 1 ? "word" : "words"}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** The pair palette (the side by side colours), for story covers: one per story, always the same. */
const STORY_HUES = 8;

/** A story's cover colour, picked from its slug so it stays the same everywhere. */
export function storyHue(slug: string): string {
  let h = 0;
  for (const c of slug) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `var(--pair-hue-${(h % STORY_HUES) + 1})`;
}
