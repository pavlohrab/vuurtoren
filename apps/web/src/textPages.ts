import type { TextListItem } from "./services/types.js";

/** Words per reader page (the reader's segment target, packages/core reading/segment.ts). */
export const WORDS_PER_PAGE = 150;

/** Reader pages of a text (estimate from its length) and the page to continue on. */
export function pagesOf(t: Pick<TextListItem, "wordCount" | "lastSegment">) {
  const pages = Math.max(1, Math.ceil(t.wordCount / WORDS_PER_PAGE));
  const page = Math.min(t.lastSegment + 1, pages);
  return { pages, page, done: Math.min(1, t.lastSegment / pages) };
}
