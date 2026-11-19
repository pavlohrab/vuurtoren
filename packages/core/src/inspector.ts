import type { TokenLabel } from "./reading/types.js";
import type { WordState } from "./memory.js";

/*
 * What the word inspector shows about one word: built by the app's services layer, rendered by
 * @app/ui (the contract lives here, not in the UI package).
 */

/** Live state of a word in Anki, read when the word is opened. */
export interface InspectorAnki {
  /**
   * absent: not in Anki; new / suspended: the matched card has never been studied;
   * learning / review: in progress; unavailable: Anki could not be asked (see `detail`).
   */
  status: "absent" | "new" | "suspended" | "learning" | "review" | "unavailable";
  /** Status line, e.g. "In review · due in 6 days", or the reason when unavailable. */
  detail?: string;
  /** Deck of the matched note (for "Moves its card to the front of ‘<deck>’"). */
  deck?: string;
  noteIds: number[];
  cardIds: number[];
  /** "Learn next" was already used on this word. */
  prioritized: boolean;
  /** The word was marked known in Anki from the app. */
  markedKnown: boolean;
  /** A manual state overrides Anki's (offer "Use Anki's state"). */
  overridden: boolean;
  /** Native mode: the cards are Kenning's own, not Anki's (the inspector words it that way). */
  native?: boolean;
  /** Native mode: the word's latest answers, newest first, with the interval each gave. */
  reviews?: InspectorReview[];
}

/** One answer from a word's review history (native mode). */
export interface InspectorReview {
  at: number;
  /** 1 Again, 2 Hard, 3 Good, 4 Easy. */
  rating: 1 | 2 | 3 | 4;
  /** The interval the answer gave, e.g. "10m", "4d", "2mo". */
  interval: string;
}

/** Everything the word inspector shows about one token. Built by the app's services layer. */
export interface InspectorEntry {
  textId: string;
  tokenIndex: number;
  surface: string;
  lemma: string;
  key: string;
  label: TokenLabel;
  state: WordState;
  /** "learning" only because of answers in Kenning. */
  appLearning?: boolean;
  pKnown: number;
  pos: string;
  /** de / het for nouns. */
  article?: string;
  glosses: string[];
  /**
   * Where `glosses[0]` came from when it is a guess: "from woord + -loos" (built from the
   * word's parts) or "in this sentence" (read off the sentence translation).
   */
  glossNote?: string;
  /**
   * What the word became in the translation of its sentence, when that differs from a guessed
   * `glosses[0]`.
   */
  sentenceGloss?: string;
  /** Anki decks this word comes from. */
  decks: string[];
  inAnki: boolean;
  anki: InspectorAnki;
  /** The sentence containing the token. */
  sentence: string;
  /** [start, end) character range of the token inside `sentence`. */
  sentenceHighlight: [number, number];
  /** Machine translation of `sentence` (offline model on the NLP server), when available. */
  sentenceTranslation?: string;
}
