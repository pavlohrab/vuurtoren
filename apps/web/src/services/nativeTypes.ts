/** Contract of native mode: reviews, decks, imports and FSRS tuning. */
import type { NearPair } from "./mergeWords.js";
import type { CardRating, DeckOptions } from "@app/core";
import type { PackageDeck } from "@app/anki";
import type { NativeDeckSummary, QueueExtra } from "@app/db";

export type { CardRating, NativeDeckSummary };

/** One card ready for the review screen. */
export interface ReviewCard {
  cardId: number;
  deck: string;
  /** Never answered before. */
  isNew: boolean;
  /**
   * vocab: Vuurtoren's own layout from the note's word, meaning and sentence; cloze: the cloze
   * text with its blank; template: the note type's own template, shown sanitised.
   */
  layout: "vocab" | "cloze" | "template";
  /** Vocabulary notes. */
  word?: string;
  article?: string;
  gloss?: string;
  sentence?: string;
  sentenceTranslation?: string;
  /**
   * What the word's clip says ("het huis"), for the system voice too: vocabulary notes, and
   * cards of imported decks with a word key and no sound of their own (said with the answer).
   */
  spoken?: string;
  /** Clip ids of the audio pack (`word-…`, `sentence-…`); the clip itself may not exist. */
  wordAudio?: string;
  sentenceAudio?: string;
  /** Rendered sides (HTML, not yet sanitised): clozes and templates; vocab notes' extra fields. */
  front: string;
  back: string;
  /** Sound files of each side, by name. */
  audioFront: string[];
  audioBack: string[];
  /** Media file name → blob id (images and sounds the card uses). */
  media: Record<string, string>;
  /** A sentence with this word from the learner's own texts. */
  ownSentence?: { text: string; title: string; highlight: [number, number] };
  /** What each button does, e.g. { 1: "1m", 2: "6m", 3: "10m", 4: "8d" }. */
  intervals: Record<CardRating, string>;
}

interface ReviewSession {
  cards: ReviewCard[];
  /** Reviewed cards due now. */
  due: number;
  /** New cards still allowed today. */
  fresh: number;
  /** When the next card not due yet becomes due (a learning step), or null: refresh then. */
  nextDue: number | null;
}

/** One card as it shows, for the before and after of Make my Anki words Vuurtoren words. */
export interface ConvertExample {
  before: { word: string; gloss: string; picture: boolean; deck: string; reviews: number };
  after: { headword: string; gloss: string; sentence: string; picture: boolean; deck: string };
}

/** What Make my Anki words Vuurtoren words would do (Settings → Your words). */
export interface AnkiConversion {
  /** Anki word notes Vuurtoren knows: they convert. */
  words: number;
  /** Of those, the words that go into the level decks, and the rarer ones. */
  levels: number;
  rarer: number;
  /** Other Anki notes: sentences, grammar, cloze, and words Vuurtoren doesn't know. */
  stay: number;
  /** One of the learner's own words, preferably one with a picture. */
  example?: ConvertExample;
}

/** What an import brought. */
export interface ImportSummary {
  notes: number;
  cards: number;
  reviews: number;
  vocabNotes: number;
  media: number;
  skippedMedia: number;
  /** Cards of the file this collection already had (they stay as they were). */
  alreadyHad?: number;
  /** Words held twice after it (Vuurtoren's copy and the file's) that are one card again. */
  merged?: number;
}

/** A deck, with about how many reviews a day each target recall would mean. */
export interface DeckWithLoad extends NativeDeckSummary {
  load: { retention: number; perDay: number }[];
}

/** What Move to Anki did. */
interface MoveToAnkiSummary {
  added: number;
  existing: number;
  skipped: number;
  scheduled: number;
  reviews: number;
}

/** What an export holds. */
interface ExportSummary {
  notes: number;
  cards: number;
  reviews: number;
  media: number;
}

/** The FSRS parameters in use and how they were tuned. */
export interface TuningInfo {
  /** Trained on the learner's reviews (false: the FSRS-6 defaults). */
  tuned: boolean;
  /** When they were last tuned (ms), or null. */
  at: number | null;
  /** Reviews used by the last tuning. */
  reviewsUsed: number;
  /** Answers held now (imported and in Vuurtoren). */
  history: number;
  logLoss?: number;
  rmse?: number;
  previousLogLoss?: number;
  previousRmse?: number;
}

export interface TuningResult extends TuningInfo {
  /** False when the trained parameters fit no better and the old ones were kept. */
  improved: boolean;
}

/** Starter word levels of 500 (1 = words 1–500). */
interface StarterLevels {
  /** Levels the learner has a deck for, lowest first. */
  held: number[];
  all: number;
  /** The level new words start from; the levels below it get no new cards. */
  from: number;
}

/** What adding starter words did. */
interface StarterAdded {
  /** New cards. */
  added: number;
  /** Words already in the learner's cards. */
  skipped: number;
}

export interface NativeServices {
  /** Native mode and today's counts (the sidebar badge and Home); `native` false: connected. */
  reviewOverview(): Promise<{ native: boolean; due: number; fresh: number }>;
  /**
   * The next cards to review, due first, then today's new cards; with `extra`, also up to
   * `extra.count` new cards past the daily limit or learned cards ahead of their date.
   */
  reviewQueue(extra?: QueueExtra): Promise<ReviewSession>;
  /** Answer a card; returns the id that `undoReview` takes back. */
  answerReview(
    cardId: number,
    rating: CardRating,
    durationMs: number,
  ): Promise<{ reviewId: string }>;
  undoReview(cardId: number, reviewId: string): Promise<void>;
  /** An image or sound of a card. */
  mediaFile(blobId: string): Promise<Blob | null>;
  /** Decks with their options, counts and the reviews a day each target recall would mean. */
  nativeDecks(): Promise<DeckWithLoad[]>;
  setDeckOptions(deck: string, options: DeckOptions): Promise<void>;
  /** Open an .apkg or .colpkg file and list its decks; `token` names it for `importPackage`. */
  openPackage(file: File): Promise<{ token: string; decks: PackageDeck[] }>;
  /**
   * One card per word: merge the words held twice by themselves, and list the near matches for
   * the learner (mock merge-and-direction.html).
   */
  mergeWords(): Promise<{ merged: number; pairs: NearPair[] }>;
  /** Merge one near match: the note with more answers stays and gets what it lacked. */
  mergePair(pair: NearPair): Promise<void>;
  /** Keep a near match as two words; it is not asked again on this device. */
  keepPairApart(pair: NearPair): void;
  /** What converting the Anki words would do, with one example. */
  ankiConversion(): Promise<AnkiConversion>;
  /**
   * Make the Anki word notes Vuurtoren words (mock anki-to-vuurtoren.html): Vuurtoren's meaning,
   * article, sentence and recordings, the pictures kept; the same cards, so reviews and schedule
   * stay, moved into the level decks (or Rarer words). The starter card of the same word goes.
   * Returns how many converted.
   */
  convertAnkiWords(onProgress?: (done: number, total: number) => void): Promise<number>;
  /** Words that came from Anki, and the rarer words with their Zipf frequency (Words' levels). */
  wordSources(): Promise<{ fromAnki: string[]; rarer: { key: string; zipf: number }[] }>;
  /** Import the chosen decks of an opened package. */
  importPackage(
    token: string,
    decks: string[],
    onProgress?: (msg: string) => void,
  ): Promise<ImportSummary>;
  /**
   * Move from Anki to Vuurtoren: import the confirmed decks from Anki (notes, cards, review
   * history), then switch the profile to native. Nothing is written to Anki.
   */
  moveFromAnki(onProgress?: (msg: string) => void): Promise<ImportSummary>;
  /**
   * Export decks and their subdecks (every deck when `decks` is empty) as an Anki package:
   * notes, cards with their schedule and memory, deck options, the review history and media.
   */
  exportPackage(
    decks: string[],
  ): Promise<{ bytes: Uint8Array; fileName: string; summary: ExportSummary }>;
  /**
   * Move to Anki, once: words become notes of Vuurtoren's type in Anki (cards that came from Anki
   * stay as they are there), reviewed cards get their due date, and with `withHistory`
   * (experimental) the review history and exact intervals too. The profile then switches to
   * Keep using Anki and reads the moved decks. Vuurtoren's own cards are kept, unused.
   */
  moveToAnki(withHistory: boolean, onProgress?: (msg: string) => void): Promise<MoveToAnkiSummary>;
  tuning(): Promise<TuningInfo>;
  /** Train the FSRS parameters on the review history now. */
  optimiseNow(onProgress?: (msg: string) => void): Promise<TuningResult>;
  /** Tune by itself when 30 days or 500 answers have passed; null when nothing was due. */
  autoTune(): Promise<TuningResult | null>;
  /**
   * The latest answer given in Vuurtoren, which Undo takes back when the review screen has none
   * of its own (after a reload or on another day); null when there is none.
   */
  lastReview(): Promise<{ cardId: number; reviewId: string; at: number } | null>;
  /** The starter word levels held. */
  starterLevels(): Promise<StarterLevels>;
  /**
   * Add starter levels as new cards, in order of rank; with `from`, new words start from that
   * level (see `setStarterFrom`). Words already held are skipped. Nothing is marked known.
   */
  /** `onProgress` hears how many words are added so far, of how many. */
  addStarterLevels(
    req: { levels: number[]; from?: number },
    onProgress?: (done: number, total: number) => void,
  ): Promise<StarterAdded>;
  /** New words start from this level: it opens now, and the levels below get no new cards. */
  setStarterFrom(level: number): Promise<void>;
}
