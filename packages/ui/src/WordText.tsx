import { type KeyboardEvent, useState } from "react";

/** A word: letters, with inner apostrophes and hyphens ("zo'n", "e-mail"). */
const WORD = /(\p{L}+(?:['’-]\p{L}+)*)/u;

export interface WordTextProps {
  text: string;
  /** A word was chosen: its form as written, and the element (to reveal it above a sheet). */
  onWord: (form: string, el: HTMLElement) => void;
  /** The word whose inspector is open (marked like a selected reader word). */
  selected?: string | null;
}

/**
 * Dutch text whose words open the word inspector, as in the reader: one tab stop for the
 * whole text, arrow keys move between words, Enter or Space opens one.
 */
export function WordText({ text, onWord, selected }: WordTextProps) {
  const parts = text.split(WORD);
  const [stop, setStop] = useState(1);
  const words = parts.length;
  const focusAt = (from: HTMLElement, i: number) => {
    const all = from.parentElement?.querySelectorAll<HTMLElement>("[data-word]");
    if (!all?.length) return;
    const j = Math.max(0, Math.min(all.length - 1, i));
    all[j]?.focus();
    setStop(Number(all[j]?.dataset["at"] ?? 1));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>, n: number, form: string) => {
    // A shortcut above already used this key (Enter going on in a lesson).
    if (e.nativeEvent.defaultPrevented) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onWord(form, e.currentTarget);
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      focusAt(e.currentTarget, n + (e.key === "ArrowRight" ? 1 : -1));
    }
  };
  let n = -1;
  return (
    <>
      {parts.map((p, i) => {
        if (i % 2 === 0) return p;
        n += 1;
        const index = n;
        return (
          <span
            key={i}
            data-word=""
            data-at={i}
            className="k-tok"
            role="button"
            tabIndex={i === (stop < words ? stop : 1) ? 0 : -1}
            data-selected={selected != null && p.toLowerCase() === selected.toLowerCase()}
            onFocus={() => setStop(i)}
            onClick={(e) => onWord(p, e.currentTarget)}
            onKeyDown={(e) => onKeyDown(e, index, p)}
          >
            {p}
          </span>
        );
      })}
    </>
  );
}
