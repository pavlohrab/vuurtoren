import type { TokenLabel, WordState } from "@app/core";

/** Everything the word inspector shows about one token. Built by the app's services layer. */
export interface InspectorEntry {
  textId: string;
  tokenIndex: number;
  surface: string;
  lemma: string;
  key: string;
  label: TokenLabel;
  state: WordState;
  pKnown: number;
  pos: string;
  /** de / het for nouns. */
  article?: string;
  glosses: string[];
  /** Anki decks this word comes from. */
  decks: string[];
  inAnki: boolean;
  /** The sentence containing the token. */
  sentence: string;
  /** [start, end) character range of the token inside `sentence`. */
  sentenceHighlight: [number, number];
}

/** Reader presentation mode. Undefined honours the plan as-is. */
export type ReaderMode = "read" | "cloze" | "gloss";
