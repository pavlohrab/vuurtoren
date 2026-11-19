/**
 * Contracts for local persistence: an append-only event log is the source of
 * truth; tables are rebuildable projections. Implemented by packages/db.
 */
import type {
  AnalyzedToken,
  Block,
  CardRating,
  CardReview,
  CardSchedule,
  DeckOptions,
  NativeCard,
  NativeDeck,
  NativeNote,
  NativeNotetype,
  BookExercise,
  Course,
  ExerciseItem,
  ExerciseKind,
  GrammarHit,
  Grade,
  ItemState,
  LanguageProfile,
  LearnerModel,
  Skill,
  StaircaseState,
  Unit,
  UnitWord,
  WordState,
} from "@app/core";

/** Minimal SQL driver so the same schema runs on sqlite-wasm (web), node:sqlite (tests), Tauri (later). */
export interface SqlDriver {
  exec(sql: string, params?: readonly SqlValue[]): Promise<Record<string, SqlValue>[]>;
  /** Run `fn` in a transaction (BEGIN/COMMIT, ROLLBACK on throw). */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export type SqlValue = string | number | bigint | Uint8Array | null;

/** One learner-model entry derived from Anki (one per key, strongest evidence already merged). */
export interface AnkiWordEntry {
  key: string;
  state: WordState;
  pKnown: number;
  noteIds: number[];
  decks: string[];
  /** Gloss/translation from the deck (e.g. English field), cleaned text. */
  gloss?: string;
  /** de/het for nouns when the card shows it. */
  article?: string;
  /** Example sentence from the deck's sentence field (first sentence, cleaned). */
  sentence?: string;
  /** English translation of `sentence`, when the note type has one. */
  sentenceTranslation?: string;
}

/** Where an imported text came from. */
export type TextSource =
  | {
      /** "talk": a Talk conversation saved to the Library (ref "talk:<conversation id>"). */
      kind: "paste" | "url" | "pdf" | "image" | "talk";
      ref?: string;
    }
  | {
      /** Written by the learner's AI provider (docs/ai.md, Stories). Never contains keys. */
      kind: "ai";
      provider: string;
      model: string;
      /** Target words the story was asked to use. */
      targets: string[];
      topic: string;
      /** Grammar topic page id the story features. */
      grammarTopic?: string;
      ref?: string;
    };

export type TextSourceKind = TextSource["kind"];

/** Editable details of a text (TextMetaUpdated). Absent = unchanged; null or "" = cleared. */
export interface TextMetaPatch {
  title?: string | null;
  author?: string | null;
  /** A free source note ("De Opmaat A2, p. 34", "NOS, 3 May"). */
  note?: string | null;
  /** A level tag, e.g. "A2". */
  level?: string | null;
}

/** A learner shelf: a named collection of texts (see library.ts). */
export interface Shelf {
  id: string;
  name: string;
  /** Texts on the shelf, newest addition first (may include deleted texts). */
  textIds: string[];
  createdAt: number;
}

/** One AI example sentence that passed validation (see SentencesGenerated). */
export interface GeneratedSentence {
  text: string;
  translation?: string;
  /** [start, end) of the target word in `text`, when there is a target lemma. */
  target?: [number, number];
  /** [start, end) spans of the grammar construction (grammar-topic sentences). */
  marks?: [number, number][];
  /** The grammar detector's note (grammar-topic sentences). */
  note?: string;
}

/** Accepted AI sentences for one (key, topic), folded from SentencesGenerated events. */
export interface GeneratedSentenceSet {
  lang: string;
  /** Practice key of the target lemma; "" for grammar-topic-only requests. */
  key: string;
  /** Grammar topic page id, when the sentences were asked to feature one. */
  topic?: string;
  sentences: GeneratedSentence[];
  /** Sentences the validator rejected (summed over requests). */
  rejected: number;
  provider: string;
  model: string;
}

export type AppEvent =
  | {
      type: "TextImported";
      textId: string;
      title: string;
      lang: string;
      source: TextSource;
      content: string;
    }
  | {
      type: "TextAnalyzed";
      textId: string;
      contentHash: string;
      tokens: AnalyzedToken[];
      /**
       * The language server's `analyzerVersion`. A text whose stored version differs
       * from the server's is re-analysed once when opened. Absent in older events.
       */
      analyzerVersion?: string;
    }
  | {
      /**
       * Grammar constructions found in a text (server `/grammar`), indices and offsets
       * relative to the whole text and its TextAnalyzed tokens. `version` is the client's
       * GRAMMAR_VERSION: hits of an older version are recomputed.
       */
      type: "TextGrammarDetected";
      textId: string;
      contentHash: string;
      version: number;
      hits: GrammarHit[];
    }
  | { type: "TextDeleted"; textId: string }
  /**
   * The learner edited a text's details (Library, reader). Last write wins per field (HLC);
   * null or "" clears a field (a cleared title shows the imported one again).
   */
  | { type: "TextMetaUpdated"; textId: string; patch: TextMetaPatch }
  /** A cover image (blob id, see library.ts) for a text; null goes back to the typographic one. */
  | { type: "TextCoverSet"; textId: string; blobId: string | null }
  /** A learner shelf ("De Opmaat", "News"): a named collection of texts. */
  | { type: "ShelfCreated"; shelfId: string; name: string }
  | { type: "ShelfRenamed"; shelfId: string; name: string }
  | { type: "ShelfDeleted"; shelfId: string }
  /** Texts put on (or taken off) a shelf; a text may be on several shelves. */
  | { type: "ShelfTextAdded"; shelfId: string; textIds: string[] }
  | { type: "ShelfTextRemoved"; shelfId: string; textIds: string[] }
  | { type: "AnkiSnapshotImported"; lang: string; entries: AnkiWordEntry[]; sources: string[] }
  | { type: "WordStateSet"; lang: string; key: string; state: WordState }
  | {
      /** The user clicked "Learn next": the word's new card(s) went to the front of the queue. */
      type: "CardsPrioritized";
      lang: string;
      key: string;
      noteId: number;
      cardIds: number[];
      /** Cards that were suspended and have been unsuspended by this action. */
      unsuspended: number[];
    }
  | {
      /** The user clicked "Mark known": the cards were rescheduled as known in Anki. */
      type: "MarkedKnownInAnki";
      lang: string;
      key: string;
      noteIds: number[];
      cardIds: number[];
    }
  | { type: "WordStateCleared"; lang: string; key: string }
  | { type: "WordLookedUp"; lang: string; key: string; textId: string }
  | {
      /**
       * One reader cloze blank was answered (first answer per blank and page visit). Feeds the
       * word's app evidence; `hinted` = a letter hint was taken first.
       */
      type: "ClozeAnswered";
      lang: string;
      key: string;
      correct: boolean;
      hinted: boolean;
      /** Answer time, ms since epoch. */
      at: number;
    }
  | { type: "NoteAddedToAnki"; lang: string; key: string; noteId: number; deck: string }
  | {
      type: "ReadingProgress";
      textId: string;
      segment: number;
      clozeAccuracy: number | null;
      lookupsPer100: number;
    }
  | { type: "StaircaseUpdated"; lang: string; state: StaircaseState }
  | {
      /**
       * One practice exercise was answered (never written to Anki). `state` is the
       * new FSRS state of (key, skill), computed by the engine at answer time and stored here so
       * replays are deterministic without the engine.
       */
      type: "ExerciseAnswered";
      lang: string;
      key: string;
      skill: Skill;
      kind: ExerciseKind;
      grade: Grade;
      correct: boolean;
      ms: number;
      /** Answer time, ms since epoch. */
      at: number;
      state: ItemState;
    }
  | {
      /** A conversation with the AI partner began. Never contains API keys. */
      type: "ConversationStarted";
      conversationId: string;
      lang: string;
      topic: string;
      targetWords: string[];
    }
  | {
      type: "MessageAdded";
      conversationId: string;
      messageId: string;
      role: "user" | "assistant";
      text: string;
      /** Assistant messages: coverage, corrections, new words (see conversations.ts). */
      meta?: Record<string, unknown>;
    }
  | {
      /**
       * AI example sentences for practice (docs/ai.md). Only validated sentences are stored;
       * an empty list records that generation was tried (so it is not repeated every session).
       */
      type: "SentencesGenerated";
      lang: string;
      key: string;
      topic?: string;
      sentences: GeneratedSentence[];
      rejected?: number;
      provider: string;
      model: string;
    }
  | { type: "SettingChanged"; key: string; value: unknown }
  /**
   * An assistant (Claude Code over MCP) suggested a word for Anki. Nothing is written to Anki:
   * the learner confirms it in the Words hub with the normal AddToAnki.
   */
  | {
      type: "WordSuggested";
      lang: string;
      key: string;
      /** Headword as the assistant wrote it, e.g. "de fiets". */
      word: string;
      gloss?: string;
      sentence?: string;
      /** Who suggested it, e.g. "claude-code". */
      by: string;
      /** Optional note, e.g. "from the cycling story". */
      note?: string;
    }
  /** The learner dismissed a suggested word (or added it to Anki). */
  | { type: "WordSuggestionDismissed"; lang: string; key: string }
  /**
   * The language profile: confirmed source decks and destination decks of one
   * language. Replaces the whole profile; last write wins by HLC.
   */
  | { type: "LanguageProfileSet"; profile: LanguageProfile }
  | { type: "CourseImported"; course: Course }
  | { type: "CourseDeleted"; courseId: string }
  /** The full outline of a course (replaces all its units). */
  | { type: "UnitDefined"; courseId: string; units: Unit[] }
  | {
      type: "UnitEdited";
      courseId: string;
      n: number;
      patch: Partial<Pick<Unit, "title" | "pages" | "ankiDecks">>;
    }
  /** All blocks of a course in page order (replaces them); units own the pages they cover. */
  | { type: "BlocksExtracted"; courseId: string; blocks: Block[] }
  /** Recognised exercises of one unit (replaces that unit's exercises). */
  | { type: "BookExerciseExtracted"; courseId: string; unitN: number; exercises: BookExercise[] }
  /**
   * AI exercises made for one unit ("Generate exercises like this unit", docs/ai.md). Only
   * items that passed the language server's checks are stored; they add to earlier ones and
   * are graded by the book checkers. Numbers start at 1001 so they never meet the book's.
   */
  | {
      type: "UnitExercisesGenerated";
      courseId: string;
      unitN: number;
      exercises: BookExercise[];
      rejected: number;
      grammarTopic?: string;
      provider: string;
      model: string;
    }
  | {
      type: "BookExerciseEdited";
      courseId: string;
      unitN: number;
      number: number;
      patch: Partial<Pick<BookExercise, "type" | "instruction" | "items">>;
    }
  | { type: "UnitWordsSet"; courseId: string; unitN: number; words: UnitWord[] }
  | {
      type: "BookExerciseAnswered";
      courseId: string;
      unitN: number;
      number: number;
      item: number;
      answer: string;
      correct: boolean;
      at: number;
      /** Course language; with `keys`, the answer feeds those words' app evidence. */
      lang?: string;
      /** Learner-model keys of the word(s) the item tests (empty or absent: none). */
      keys?: string[];
    }
  /**
   * Native mode: notes and cards entered Kenning (an .apkg file, a move from Anki, or Add to my
   * words), with the note types and decks they need, their review history and their media
   * (file name → blob id). Notes and cards already present are kept as they are; note types
   * and decks are added when missing. Large imports arrive as several events.
   */
  | {
      type: "NativeNotesAdded";
      lang: string;
      origin: "apkg" | "anki" | "kenning";
      notetypes?: NativeNotetype[];
      decks?: NativeDeck[];
      notes: NativeNote[];
      cards: NativeCard[];
      reviews?: CardReview[];
      media?: Record<string, string>;
    }
  /** Native mode: a deck's scheduling options. Last write wins per deck (HLC). */
  | { type: "NativeDeckOptionsSet"; lang: string; deck: string; options: DeckOptions }
  /**
   * Native mode: one card was answered on the review screen. `schedule` is the card after the
   * answer and `previous` the card before it (absent: it was new), so replays and undo need no
   * scheduler.
   */
  | {
      type: "CardReviewed";
      lang: string;
      cardId: number;
      rating: CardRating;
      at: number;
      durationMs: number;
      schedule: CardSchedule;
      previous?: CardSchedule;
    }
  /** Native mode: the answer recorded by CardReviewed `reviewId` was taken back. */
  | { type: "CardReviewUndone"; lang: string; cardId: number; reviewId: string }
  /**
   * Native mode: cards changed outside a review: marked known, studied first, or their memory
   * recomputed with new FSRS parameters.
   */
  | {
      type: "NativeCardsChanged";
      lang: string;
      reason: "known" | "first" | "memory";
      changes: NativeCardChange[];
    }
  /**
   * Native mode: FSRS parameters trained on the learner's reviews (or the defaults). Log loss
   * and RMSE compare the new parameters with the ones they replace, on the same reviews.
   */
  | {
      type: "FsrsParamsSet";
      lang: string;
      params: number[];
      /** Reviews the optimizer trained on. */
      reviews: number;
      /** Answers in the whole history at the time (for "500 new reviews since"). */
      historySize?: number;
      logLoss?: number;
      rmse?: number;
      previousLogLoss?: number;
      previousRmse?: number;
    }
  | {
      /**
       * One finished exam-preparation session: a practice round or a timed mock
       * exam of one part. Scores only; spoken audio is never stored.
       */
      type: "ExamAttempt";
      lang: string;
      /** Exam bank id, e.g. "nl-a2". */
      exam: string;
      /** "lezen" | "luisteren" | "schrijven" | "spreken" | "knm". */
      part: string;
      mode: "exam" | "practice";
      /** What was taken: "set:1", "theme:wonen", "task:sc-1-02", "ai". */
      setId: string;
      correct: number;
      total: number;
      /** Estimated pass mark (points) for `total`. */
      passMark: number;
      durationMs: number;
      at: number;
      /** Ids of the items answered wrongly or not ticked. */
      missed?: string[];
      /** Words worth learning from what went wrong (lemma keys). */
      words?: string[];
    };

/** Native mode: one change to a card outside a review (see NativeCardsChanged). */
export interface NativeCardChange {
  cardId: number;
  /** New schedule; null makes the card new again. Absent = unchanged. */
  schedule?: CardSchedule | null;
  suspended?: boolean;
  /** New place in the new queue. */
  position?: number;
}

/** An open word suggestion (see `suggestedWords`). */
export interface SuggestedWord {
  lang: string;
  key: string;
  word: string;
  gloss?: string;
  sentence?: string;
  by: string;
  note?: string;
  /** Event id of the latest suggestion (ULID, time-sortable). */
  id: string;
}

/** Every event type this app version understands (checked against `AppEvent` at compile time). */
const EVENT_TYPE_MAP = {
  TextImported: 1,
  TextAnalyzed: 1,
  TextGrammarDetected: 1,
  TextDeleted: 1,
  TextMetaUpdated: 1,
  TextCoverSet: 1,
  ShelfCreated: 1,
  ShelfRenamed: 1,
  ShelfDeleted: 1,
  ShelfTextAdded: 1,
  ShelfTextRemoved: 1,
  AnkiSnapshotImported: 1,
  WordStateSet: 1,
  CardsPrioritized: 1,
  MarkedKnownInAnki: 1,
  WordStateCleared: 1,
  WordLookedUp: 1,
  ClozeAnswered: 1,
  NoteAddedToAnki: 1,
  ReadingProgress: 1,
  StaircaseUpdated: 1,
  ExerciseAnswered: 1,
  ConversationStarted: 1,
  MessageAdded: 1,
  SentencesGenerated: 1,
  SettingChanged: 1,
  WordSuggested: 1,
  WordSuggestionDismissed: 1,
  LanguageProfileSet: 1,
  CourseImported: 1,
  CourseDeleted: 1,
  UnitDefined: 1,
  UnitEdited: 1,
  BlocksExtracted: 1,
  BookExerciseExtracted: 1,
  UnitExercisesGenerated: 1,
  BookExerciseEdited: 1,
  UnitWordsSet: 1,
  BookExerciseAnswered: 1,
  ExamAttempt: 1,
  NativeNotesAdded: 1,
  NativeDeckOptionsSet: 1,
  CardReviewed: 1,
  CardReviewUndone: 1,
  NativeCardsChanged: 1,
  FsrsParamsSet: 1,
} as const satisfies Record<AppEvent["type"], 1>;

export const EVENT_TYPES: ReadonlySet<string> = new Set(Object.keys(EVENT_TYPE_MAP));

/** Stored course with its outline. */
export interface CourseRecord extends Course {
  units: Unit[];
}

/** The latest answer to one item of a book exercise. */
export interface BookAnswerRecord {
  unitN: number;
  number: number;
  item: number;
  answer: string;
  correct: boolean;
  at: number;
}

/** Item-level helper type re-exported for consumers that edit items. */
export type { ExerciseItem as BookExerciseItem };

export interface StoredEvent {
  /** ULID: time-sortable, unique across devices. */
  id: string;
  deviceId: string;
  /** Hybrid logical clock "<ms>-<counter>-<deviceId>" for cross-device ordering. */
  hlc: string;
  event: AppEvent;
}

export interface TextSummary {
  id: string;
  title: string;
  lang: string;
  sourceKind: TextSourceKind;
  /** Where the text came from: URL, file name, "course:<id>:<unit>", "talk:<id>"… */
  sourceRef?: string;
  createdAt: number;
  wordCount: number;
  analyzed: boolean;
  lastSegment: number;
  /** The title as imported, when the learner renamed the text (`title` is the edited one). */
  importedTitle?: string;
  author?: string;
  /** Source note set by the learner. */
  note?: string;
  /** Level tag set by the learner, e.g. "A2". */
  level?: string;
  /** Blob id of the cover image (TextCoverSet); absent = typographic cover. */
  coverId?: string;
}

export interface StoredText extends TextSummary {
  content: string;
  tokens: AnalyzedToken[] | null;
  /** Analyzer version of `tokens` (null/absent: unknown, analysed before versions existed). */
  analyzerVersion?: string | null;
}

export interface WordInfo {
  key: string;
  state: WordState;
  pKnown: number;
  source: "anki" | "app";
  gloss?: string;
  article?: string;
  /** Example sentence from Anki (and its English translation). */
  sentence?: string;
  sentenceTranslation?: string;
  decks: string[];
  lookups: number;
  addedNoteId?: number;
  /** Anki notes behind this word (snapshot notes, plus a note the app added). */
  noteIds: number[];
  /** "Learn next" was used on this word. */
  prioritized?: boolean;
  /** The word was marked known in Anki from the app (a manual override). */
  markedKnownInAnki?: boolean;
  /** A manual state (set in the app) currently overrides Anki's. */
  overridden?: boolean;
  /** Answers given in Kenning (practice, reader clozes, book exercises). */
  evidence?: { correct: number; wrong: number; lastAt: number };
  /** App evidence alone made this word "learning": shown as "Learning (in Kenning)". */
  appLearning?: boolean;
}

/** Grammar hits stored for one text (TextGrammarDetected). */
export interface TextGrammar {
  textId: string;
  version: number;
  hits: GrammarHit[];
}

/** One learning event, as listed by `activity` (Home's week strip). */
export interface ActivityEntry {
  /** Pages read, exercises answered (in Practice or as a reader cloze) and words added to Anki. */
  kind: "page" | "exercise" | "added";
  at: number;
}

/** One answered exercise, as listed by `practiceLog`. */
export interface PracticeLogEntry {
  key: string;
  skill: Skill;
  kind: ExerciseKind;
  grade: Grade;
  correct: boolean;
  ms: number;
  at: number;
}

/** One ExamAttempt as stored (see exam.ts). */
export interface ExamAttemptRecord {
  id: string;
  exam: string;
  part: string;
  mode: "exam" | "practice";
  setId: string;
  correct: number;
  total: number;
  passMark: number;
  durationMs: number;
  at: number;
  missed: string[];
  words: string[];
}

/** Native mode: a deck with its options and card counts. */
export interface NativeDeckSummary extends NativeDeck {
  total: number;
  /** Cards never answered. */
  fresh: number;
  /** Reviewed cards (learning and review) due now. */
  due: number;
  suspended: number;
}

/** Native mode: a card with everything the review screen needs. */
export interface NativeCardView {
  card: NativeCard;
  note: NativeNote;
  notetype: NativeNotetype;
  options: DeckOptions;
}

/** Native mode: everything of some decks, for an export (`nativeCollection`). */
export interface NativeCollection {
  notetypes: NativeNotetype[];
  decks: { name: string; options: DeckOptions }[];
  notes: NativeNote[];
  cards: NativeCard[];
  /** The review history of these cards, oldest first. */
  reviews: CardReview[];
  /** Media files held (name → blob id); the export keeps the ones its notes use. */
  media: Record<string, string>;
}

/** Native mode: the cards of one review session, in order, and what is left today. */
export interface NativeQueue {
  /** Due (re)learning and review cards first, then today's new cards. */
  cards: NativeCardView[];
  /** Reviewed cards due now. */
  due: number;
  /** New cards still allowed today. */
  fresh: number;
}

/** Native mode: the live state of a note's cards, shaped like @app/anki NoteCardStatus. */
export interface NativeNoteStatus {
  noteId: number;
  deck: string;
  cards: {
    cardId: number;
    type: "new" | "learning" | "review" | "relearning";
    suspended: boolean;
    buried: boolean;
    intervalDays: number;
    dueText?: string;
  }[];
}

/** Native mode: the FSRS parameters in use (FsrsParamsSet), or null for the defaults. */
export interface FsrsParamsRecord {
  params: number[];
  reviews: number;
  historySize?: number;
  /** When they were set (ms). */
  at: number;
  logLoss?: number;
  rmse?: number;
  previousLogLoss?: number;
  previousRmse?: number;
}

/** Repository API used by apps (web/desktop/extension). */
export interface Repository {
  append(event: AppEvent): Promise<StoredEvent>;
  listTexts(): Promise<TextSummary[]>;
  getText(id: string): Promise<StoredText | null>;
  /** Merged learner model for a language: Anki snapshot overlaid with app word-state events. */
  learnerModel(lang: string): Promise<LearnerModel>;
  word(lang: string, key: string): Promise<WordInfo | null>;
  words(
    lang: string,
    opts?: {
      state?: WordState;
      limit?: number;
      offset?: number;
      /** case-insensitive key prefix */ query?: string;
    },
  ): Promise<WordInfo[]>;
  staircase(lang: string): Promise<StaircaseState | null>;
  /** FSRS state of every practised (key, skill) pair of a language. */
  practiceItems(lang: string): Promise<ItemState[]>;
  /** Newest-first answers (ExerciseAnswered events), at most `limit`. */
  practiceLog(lang: string, limit: number): Promise<PracticeLogEntry[]>;
  /** Pages read, exercises answered and words added since `sinceMs` (any language), oldest first. */
  activity(sinceMs: number): Promise<ActivityEntry[]>;
  /** Stored grammar hits of a text (null when none are stored for its current content). */
  textGrammar(textId: string): Promise<TextGrammar | null>;
  /** Stored grammar hits of every text that has them (for the grammar index). */
  allTextGrammar(): Promise<TextGrammar[]>;
  setting<T>(key: string): Promise<T | undefined>;
  /** The language profile of `lang`, or null if none was saved. */
  languageProfile(lang: string): Promise<LanguageProfile | null>;
  /** Courses with their outlines, newest first. */
  courses(): Promise<CourseRecord[]>;
  /** All blocks of a course in page order. */
  courseBlocks(courseId: string): Promise<Block[]>;
  /** Exercises of a unit in book order, with user edits applied. */
  unitExercises(courseId: string, unitN: number): Promise<BookExercise[]>;
  unitWords(courseId: string, unitN: number): Promise<UnitWord[]>;
  /** AI exercises made for a unit (UnitExercisesGenerated events, oldest first). */
  generatedUnitExercises(courseId: string, unitN: number): Promise<BookExercise[]>;
  /** Latest answers of the exercises of a unit (all units when `unitN` is omitted). */
  bookAnswers(courseId: string, unitN?: number): Promise<BookAnswerRecord[]>;
  /** The learner's shelves in creation order (Shelf* events). */
  shelves(): Promise<Shelf[]>;
  /** Store an image (content-addressed); returns its id. Rejects over 2 MB or a non-image type. */
  putBlob(bytes: Uint8Array, type: string): Promise<string>;
  /** A stored image, or null. */
  getBlob(id: string): Promise<{ type: string; bytes: Uint8Array } | null>;
  /** Native mode: decks with their options and card counts at `now`. */
  nativeDecks(lang: string, now: number): Promise<NativeDeckSummary[]>;
  /**
   * Native mode: the cards to review at `now`: due cards, then new cards within each deck's
   * daily limit (counted from `dayStart`, the start of the learner's study day), at most `limit`.
   */
  nativeQueue(lang: string, now: number, dayStart: number, limit: number): Promise<NativeQueue>;
  /** Native mode: one card with its note, note type and deck options. */
  nativeCard(lang: string, cardId: number): Promise<NativeCardView | null>;
  /** Native mode: the whole review history (imported and answered in Kenning), oldest first. */
  nativeReviews(lang: string): Promise<CardReview[]>;
  /**
   * Native mode: the note types, notes, cards, review history and media of some decks (and
   * their subdecks); every deck when `decks` is empty. For an export.
   */
  nativeCollection(lang: string, decks: string[]): Promise<NativeCollection>;
  /** Native mode: notes, cards and answers held, for Settings. */
  nativeStats(lang: string): Promise<{ notes: number; cards: number; reviews: number }>;
  /** Native mode: the FSRS parameters in use, or null for the defaults. */
  fsrsParams(lang: string): Promise<FsrsParamsRecord | null>;
  /** Native mode: blob ids of media files by name (names without a blob are left out). */
  nativeMedia(lang: string, names: string[]): Promise<Record<string, string>>;
  /** Native mode: the cards of some notes, for the word inspector. */
  nativeNoteStatus(lang: string, noteIds: number[], now: number): Promise<NativeNoteStatus[]>;
  /** Drop projections and rebuild them from the event log. */
  rebuild(): Promise<void>;
}
