/**
 * Native mode: the cards Vuurtoren holds itself. Pure data shared by the database projections,
 * the importers and the review screen.
 */

/** Again, Hard, Good, Easy. */
export type CardRating = 1 | 2 | 3 | 4;

/** FSRS memory and schedule of one reviewed card (ts-fsrs Card, dates as ms since epoch). */
export interface CardSchedule {
  due: number;
  stability: number;
  difficulty: number;
  scheduledDays: number;
  /** Index of the current (re)learning step. */
  learningSteps: number;
  reps: number;
  lapses: number;
  /** 1 Learning, 2 Review, 3 Relearning (a new card has no schedule). */
  state: 1 | 2 | 3;
  lastReview: number;
}

/** Scheduling options of one deck. */
export interface DeckOptions {
  /** Target probability of recall at the due date. */
  desiredRetention: number;
  /** Learning steps in minutes. */
  learningSteps: number[];
  /** Relearning steps in minutes. */
  relearningSteps: number[];
  /** Longest interval in days. */
  maxInterval: number;
  /** New cards introduced per day. */
  newPerDay: number;
}

export const DEFAULT_DECK_OPTIONS: DeckOptions = {
  desiredRetention: 0.9,
  learningSteps: [1, 10],
  relearningSteps: [10],
  maxInterval: 36500,
  newPerDay: 20,
};

/** A deck of native cards. Decks are named like Anki's, levels joined by `::`. */
export interface NativeDeck {
  name: string;
  options: DeckOptions;
}

/** How a note type is shown on the review screen. */
export type NotetypeKind = "standard" | "cloze";

/** Which fields of a note type hold the vocabulary (detected on import). */
export interface VocabFields {
  word: string;
  sentence?: string;
  gloss?: string;
  sentenceTranslation?: string;
}

export interface NativeTemplate {
  name: string;
  front: string;
  back: string;
}

/** A note type: field names, card templates and styling, as Anki defines them. */
export interface NativeNotetype {
  /** Stable id: `anki:<id>` for imported types, `vuurtoren-word` for Vuurtoren's own. */
  id: string;
  name: string;
  kind: NotetypeKind;
  fields: string[];
  templates: NativeTemplate[];
  css: string;
  /** The vocabulary fields when this is a vocabulary note type. */
  vocab?: VocabFields;
}

/** One note with its learner-model facts, worked out when it was added. */
export interface NativeNote {
  id: number;
  notetypeId: string;
  /** Field values in note-type order (HTML as in Anki). */
  fields: string[];
  tags: string[];
  /** Learner-model key of the headword (vocabulary notes only). */
  key?: string;
  aliases?: string[];
  article?: string;
  gloss?: string;
  sentence?: string;
  sentenceTranslation?: string;
}

export interface NativeCard {
  id: number;
  noteId: number;
  /** Template index (standard notes) or cloze number − 1 (cloze notes). */
  ord: number;
  deck: string;
  /** Absent for a new card. */
  schedule?: CardSchedule;
  suspended?: boolean;
  /** Order in the new queue (lower first). */
  position: number;
}

/** One answer from the review history. */
export interface CardReview {
  cardId: number;
  /** Answer time, ms since epoch. */
  at: number;
  /** 1–4; 0 for a manual reschedule or reset, which is not an answer. */
  rating: 0 | CardRating;
  /** How the card was answered: learn, review, relearn, filtered deck, manual change. */
  kind: "learn" | "review" | "relearn" | "filtered" | "manual";
  /** Answer time in ms (0 when unknown). */
  durationMs: number;
}
