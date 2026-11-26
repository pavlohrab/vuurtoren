/**
 * The word card's state, in one place (F2, `notes/wc2-word-card.md`): the words opened from the
 * card (its base verb, a family word …). It lives in
 * the page that shows the card, not in the card, so loading the next word changes nothing, and
 * the reader can keep it when a grammar link leaves the page (readerReturn.ts).
 *
 * Back undoes one step: back one word, then the card closes (the page does that last step).
 * There is one entry (WC12): the card grows into it when pulled up, so no "full entry" state.
 */
import { useCallback, useState } from "react";
import { useBackClose } from "../../shell/backStack.js";

export interface WordCardState {
  /** Words opened from the card, the shown one last. */
  stack: string[];
}

export function useWordCard(initial?: Partial<WordCardState> | null) {
  const [stack, setStack] = useState<string[]>(initial?.stack ?? []);

  const openWord = useCallback(
    (w: string) => setStack((st) => (st.at(-1) === w ? st : [...st, w])),
    [],
  );
  const backWord = useCallback(() => setStack((st) => st.slice(0, -1)), []);
  /** Another word of the text: the card starts over for it, in the view it was in. */
  const restart = useCallback(() => setStack([]), []);
  /** The card closed: the next one opens small, with nothing stacked. */
  const close = useCallback(() => setStack([]), []);
  useBackClose(stack.length > 0, backWord);
  return { stack, openWord, backWord, restart, close };
}
