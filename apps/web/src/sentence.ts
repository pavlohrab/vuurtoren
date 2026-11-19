/** Sentences of plain text (Talk messages, practice sentences). */

/** The sentence of `text` that contains `form` as a word (the whole text when none does). */
export function sentenceWith(text: string, form: string): string {
  const sentences = text.match(/[^.!?…]+[.!?…]*/gu) ?? [text];
  const word = new RegExp(
    `(^|[^\\p{L}])${form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}])`,
    "iu",
  );
  return (sentences.find((s) => word.test(s)) ?? text).trim();
}
