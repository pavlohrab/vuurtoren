/**
 * The way back to the reader from a grammar topic it opened (m5, RD5). The reader saves where
 * you were (text, page, selected word, focus topic) when you follow one of its grammar links;
 * Back on that topic returns to the text and the reader puts you back on that page with that
 * word selected. Kept for this browser session only, and only for the topic that was opened,
 * so a later visit to Grammar from elsewhere never sends you to an old text.
 */
import { createContext, useContext } from "react";

const KEY = "vuurtoren.readerReturn";

export interface ReaderReturn {
  textId: string;
  /** The reader's page (segment) when you left. */
  segment: number;
  selected: number | null;
  focusTopic: string | null;
  /** The grammar topic the reader opened. */
  topic: string;
}

function read(): ReaderReturn | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ReaderReturn) : null;
  } catch {
    // storage blocked or a broken value: no way back, Back works as before
    return null;
  }
}

export function rememberReader(r: ReaderReturn): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    // storage blocked: Back goes one level up as before
  }
}

/** The reader to return to from grammar topic `topic`, or null. */
export function readerReturnFor(topic: string): ReaderReturn | null {
  const r = read();
  return r && r.topic === topic ? r : null;
}

/** The saved place in text `textId`, used once by the reader when it opens again. */
export function takeReaderReturn(textId: string): ReaderReturn | null {
  const r = read();
  if (!r || r.textId !== textId) return null;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // storage blocked: nothing to clear
  }
  return r;
}

/** Given by the reader: save where we are before following a grammar link to `topic`. */
export const ReaderLeave = createContext<((topic: string) => void) | null>(null);

/** The reader's "save where we are" (null outside the reader, e.g. on Words). */
export function useReaderLeave(): ((topic: string) => void) | null {
  return useContext(ReaderLeave);
}
