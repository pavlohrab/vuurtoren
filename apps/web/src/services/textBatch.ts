import type { KenningRepository, StoredText, TextSummary } from "@app/db";

/** Words of text (tokens) per batched `getTexts` call: bounds one server-mode response. */
export const TEXT_BATCH_WORDS = 150_000;

/**
 * Full texts (content and tokens) for `summaries`, in their order, with as few repository calls
 * as possible (review A8): one `getTexts` per ~150k words instead of one `getText` per text.
 */
export async function fetchTexts(
  repo: Pick<KenningRepository, "getTexts">,
  summaries: readonly Pick<TextSummary, "id" | "wordCount">[],
  maxWords: number = TEXT_BATCH_WORDS,
): Promise<StoredText[]> {
  const batches: string[][] = [];
  let words = Infinity;
  for (const s of summaries) {
    if (words + s.wordCount > maxWords) {
      batches.push([]);
      words = 0;
    }
    batches[batches.length - 1]!.push(s.id);
    words += s.wordCount;
  }
  return (await Promise.all(batches.map((ids) => repo.getTexts(ids)))).flat();
}
