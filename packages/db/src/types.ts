/**
 * Contracts for local persistence (ADR 0002): an append-only event log is the source of
 * truth; tables are rebuildable projections. Implemented by packages/db.
 */
import type {
  AnalyzedToken,
  Block,
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
  | { type: "TextAnalyzed"; textId: string; contentHash: string; tokens: AnalyzedToken[] }
  | {
      /**
       * Grammar constructions found in a text (M5; server `/grammar`), indices and offsets
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
       * word's app evidence (ADR 0011); `hinted` = a letter hint was taken first.
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
       * One practice exercise was answered (ADR 0003: never written to Anki). `state` is the
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
      /** A conversation with the AI partner began (M6). Never contains API keys. */
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
   * The language profile (ADR 0010): confirmed source decks and destination decks of one
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
      /** Course language; with `keys`, the answer feeds those words' app evidence (ADR 0011). */
      lang?: string;
      /** Learner-model keys of the word(s) the item tests (empty or absent: none). */
      keys?: string[];
    };

/** Every event type this app version understands (checked against `AppEvent` at compile time). */
const EVENT_TYPE_MAP = {
  TextImported: 1,
  TextAnalyzed: 1,
  TextGrammarDetected: 1,
  TextDeleted: 1,
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
  /** Hybrid logical clock "<ms>-<counter>-<deviceId>" for cross-device ordering (M7). */
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
}

export interface StoredText extends TextSummary {
  content: string;
  tokens: AnalyzedToken[] | null;
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
  /** Answers given in Kenning (practice, reader clozes, book exercises; ADR 0011). */
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
  /** The language profile of `lang` (ADR 0010), or null if none was saved. */
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
  /** Drop projections and rebuild them from the event log. */
  rebuild(): Promise<void>;
}
