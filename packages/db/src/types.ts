/**
 * Contracts for local persistence (ADR 0002): an append-only event log is the source of
 * truth; tables are rebuildable projections. Implemented by packages/db.
 */
import type {
  AnalyzedToken,
  ExerciseKind,
  Grade,
  ItemState,
  LearnerModel,
  Skill,
  StaircaseState,
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

export type AppEvent =
  | {
      type: "TextImported";
      textId: string;
      title: string;
      lang: string;
      source: { kind: "paste" | "url" | "pdf" | "image"; ref?: string };
      content: string;
    }
  | { type: "TextAnalyzed"; textId: string; contentHash: string; tokens: AnalyzedToken[] }
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
  | { type: "SettingChanged"; key: string; value: unknown };

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
  sourceKind: "paste" | "url" | "pdf" | "image";
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
  setting<T>(key: string): Promise<T | undefined>;
  /** Drop projections and rebuild them from the event log. */
  rebuild(): Promise<void>;
}
