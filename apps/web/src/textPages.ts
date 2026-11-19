import type { TextListItem } from "./services/types.js";

/** Words per reader page (the reader's segment target, packages/core reading/segment.ts). */
export const WORDS_PER_PAGE = 150;

type PageFields = Pick<TextListItem, "wordCount" | "lastSegment"> & {
  pages?: number | null | undefined;
};

/**
 * Reader pages of a text and the page to continue on. The page count is the reading plan's
 * (`TextListItem.pages`, what the reader shows); only an unanalysed text is estimated from its
 * length.
 */
export function pagesOf(t: PageFields) {
  const pages = t.pages ?? Math.max(1, Math.ceil(t.wordCount / WORDS_PER_PAGE));
  const page = Math.min(t.lastSegment + 1, pages);
  return { pages, page, done: Math.min(1, t.lastSegment / pages) };
}

/** Where a text stands: not started, in progress (page to continue on) or finished. */
export function readingState(
  t: PageFields,
): { kind: "new" } | { kind: "reading"; page: number; pages: number } | { kind: "done" } {
  const { page, pages } = pagesOf(t);
  if (t.lastSegment <= 0) return { kind: "new" };
  if (t.lastSegment >= pages) return { kind: "done" };
  return { kind: "reading", page, pages };
}

/**
 * The texts in progress (Library's Reading now shelf, Home's Continue reading): the one opened
 * last first, then the others in the given order. Finished texts are never in it.
 */
export function readingNow<T extends TextListItem>(
  texts: readonly T[],
  lastId: string | null,
): T[] {
  const reading = texts.filter((t) => readingState(t).kind === "reading");
  const last = reading.find((t) => t.id === lastId);
  return last ? [last, ...reading.filter((t) => t !== last)] : reading;
}

/**
 * The text to continue: the first of Reading now; else the next to read, which is the text
 * opened last when it is not started yet, or the unstarted text with the highest coverage (the
 * gentlest start). Null when every text is finished.
 */
export function pickContinue(
  texts: readonly TextListItem[],
  lastId: string | null,
): { text: TextListItem; started: boolean } | null {
  const now = readingNow(texts, lastId)[0];
  if (now) return { text: now, started: true };
  const fresh = texts.filter((t) => readingState(t).kind === "new");
  const last = fresh.find((t) => t.id === lastId);
  if (last) return { text: last, started: false };
  const ranked = [...fresh].sort((a, b) => (b.coverage ?? -1) - (a.coverage ?? -1));
  return ranked[0] ? { text: ranked[0], started: false } : null;
}
