import type {
  AnalyzedToken,
  Attempt,
  Exercise,
  ExerciseKind,
  Grade,
  GrammarHit,
  ItemState,
  SegmentPlan,
  Skill,
  StaircaseState,
  WordState,
} from "@app/core";
import type { StoredText, SuggestedWord, TextSummary, WordInfo } from "@app/db";
import type { InspectorEntry } from "@app/core";
import type { CourseServices } from "./courseTypes.js";
import type { OcrReviewHandler } from "./ocrReview.js";
import type { AIServices, AISentenceReport } from "./aiTypes.js";
import type { AddOptions, ProfileServices } from "./profileTypes.js";
import type { ActivityDay } from "./activity.js";
import type { ExamServices } from "./examTypes.js";
import type { LibraryServices } from "./libraryTypes.js";
import type { NativeServices } from "./nativeTypes.js";

/** Defined in @app/ui (the WordInspector consumes it); re-exported here as part of the contract. */
export type { InspectorEntry };

export interface ReadingView {
  text: StoredText;
  tokens: AnalyzedToken[];
  plans: SegmentPlan[];
  staircase: StaircaseState;
}
/** One word of the end-of-text review ("Words from this text"). */
export interface TextWordItem {
  key: string;
  lemma: string;
  /** de / het for nouns. */
  article?: string;
  pos: string;
  /** Meanings, best first: Anki gloss, then the dictionary sense for the part of speech. */
  glosses: string[];
  /** The sentence of the first occurrence in the text. */
  sentence: string;
  /** [start, end) character range of the word inside `sentence`. */
  sentenceHighlight: [number, number];
  tokenIndex: number;
  /** Why it stands out: highlighted to learn, looked up while reading, or only translated. */
  source: "introduce" | "lookup" | "gloss";
  /** Same entry the word inspector uses, so addToAnki / learnNext / markKnown work unchanged. */
  entry: InspectorEntry;
}
export interface TextListItem extends TextSummary {
  /** Share of the text's words known (same value as the reader bar); null until analysed. */
  coverage: number | null;
  /** Number of new words: the length of `textWords` for the text. */
  newTypes: number | null;
  /** Reader pages (the reading plan's segments); null until analysed. */
  pages: number | null;
}
export interface Settings {
  ankiUrl: string;
  ankiKey?: string;
  nlpUrl: string;
  lang: "nl";
  /**
   * @deprecated Kept to migrate older users: the language profile's destinations decide where
   * new words go.
   */
  targetDeck: string;
  theme: "system" | "light" | "dark";
  /** Reader help dial in [0, 1]: which words get an inline translation (see core help.ts). */
  help: number;
  /** New words introduced per 150-word page: "auto" follows the adaptive staircase. */
  newWords: number | "auto";
  /** Gloss mode: also show cloze blanks (off by default). */
  glossClozes: boolean;
  /**
   * Reader: quiet margin marks beside sentences with grammar worth noticing (on by default).
   * Replaces `grammarSpotlights` (underline every construction), migrated on load.
   */
  grammarMarks: boolean;
}
export interface ImportOptions {
  review?: OcrReviewHandler;
}

export type ImportInput =
  | {
      kind: "paste";
      title?: string;
      content: string;
      /** e.g. "course:<id>:<unit>" */ ref?: string;
    }
  | {
      /** A Talk conversation saved to the Library (ref "talk:<conversation id>"). */
      kind: "talk";
      title: string;
      content: string;
      ref?: string;
    }
  | { kind: "url"; url: string }
  | { kind: "pdf" | "image"; file: File; title?: string };
export interface AnkiStatus {
  connected: boolean;
  /** Detailed state: see AnkiConnectionState in @app/anki. */
  state: "connected" | "not-running" | "not-allowed" | "needs-key" | "busy";
  version?: number;
  error?: string;
}
/** Outcome of "Connect to Anki" (asks Anki to allow this site, then re-tests). */
interface AnkiConnectResult {
  /** True if the user answered No in Anki's dialog. */
  denied: boolean;
  status: AnkiStatus;
}
export interface LearnerSummary {
  known: number;
  learning: number;
  unknown: number;
  vocabEstimate: number;
  lastSync: number | null;
  sources: string[];
  /** Native mode: Kenning's own cards are the record (no Anki sync involved). */
  native?: boolean;
}

/** What the Practice start screen and the sidebar badge show. */
export interface PracticeOverview {
  /** (word, skill) items whose review is due now. */
  due: number;
  /** Words you are learning that have not been practised yet. */
  newAvailable: number;
  /** Items in long-term review, over all skills. */
  learned: number;
  /** Learned items per skill. */
  bySkill: Record<Skill, number>;
  /** When (ms) the last exercise was answered. */
  lastSession: number | null;
  /** The language server was unreachable on the last request (fewer exercise types). */
  degraded?: boolean;
}
/** The learner's answer; correctness is decided by the engine, not the caller. */
export type AttemptInput = Omit<Attempt, "correct">;
export interface AnswerResult {
  grade: Grade;
  correct: boolean;
  /** Extra line from the checker, e.g. an accent reminder. */
  note?: string;
  /** New scheduling state of the (word, skill) pair. */
  next: ItemState;
}

/** Grammar hits over the Library (the grammar index). */
export interface GrammarOverview {
  /** Hits per detector topic id, over all analysed texts. */
  counts: Record<string, number>;
  /** Texts per detector topic id (how many texts contain it at least once). */
  textCounts: Record<string, number>;
  /** Analysed texts that were scanned. */
  texts: number;
  /** Analysed texts whose grammar could not be computed (the language server is unreachable). */
  missing: number;
}
/** A sentence from the learner's own texts in which a topic was detected. */
export interface LibraryGrammarExample {
  textId: string;
  title: string;
  /** Detector topic id. */
  topic: string;
  sentence: string;
  /** [start, end) spans of the construction's words in `sentence`. */
  marks: [number, number][];
  note: string;
}
/** A Tatoeba sentence in which a topic was detected (server `/grammar/examples`). */
export interface TatoebaGrammarExample {
  topic: string;
  text: string;
  translation: string;
  marks: [number, number][];
  note: string;
}
export interface TopicExamples {
  library: LibraryGrammarExample[];
  tatoeba: TatoebaGrammarExample[];
  /** Tatoeba examples could not be loaded (server unreachable or sentence DB not built). */
  tatoebaUnavailable: boolean;
}
/** What a topic exercise session trains: the page's detectors and exercise kinds. */
export interface TopicPracticeOptions {
  detects: string[];
  kinds: ExerciseKind[];
  /** Number of exercises (default 10). */
  size?: number;
  /** Grammar topic page id (needed for AI sentences). */
  topicId?: string;
  /** Ask the AI provider for sentences when the topic has few hits (see docs/ai.md). */
  aiSentences?: boolean;
  onAISentences?: (report: AISentenceReport) => void;
}

/** Options of a vocabulary practice session. */
export interface PracticeOptions {
  size?: number;
  skills?: Skill[];
  /** Fill words with fewer than 3 good sentences with validated AI sentences (capped). */
  aiSentences?: boolean;
  /** Called once with what the AI fill did (only when `aiSentences` was asked for). */
  onAISentences?: (report: AISentenceReport) => void;
  /**
   * Practise only these words (lemma keys), due or not: "Practise these words" from Words,
   * Words from this text and the Practice summary. Scheduling still uses each item's own state.
   */
  keys?: string[];
}

/**
 * Everything the UI needs from the outside world. The app never talks to the database,
 * AnkiConnect or the NLP server directly; swap the implementation passed to <ServicesProvider>.
 */
export interface AppServices
  extends
    CourseServices,
    AIServices,
    ProfileServices,
    ExamServices,
    LibraryServices,
    NativeServices {
  /**
   * Server mode only: ask the server whether another device changed the shared
   * data; if so, drop the service caches and return true (the caller then refetches its
   * queries). Absent in browser and demo mode. Rejects when the server is unreachable.
   */
  checkRemoteChanges?(): Promise<boolean>;
  listTexts(): Promise<TextListItem[]>;
  getReading(textId: string): Promise<ReadingView | null>;
  /**
   * Import a text. For a photo or a scanned PDF, `opts.review` is shown the recognised text and
   * the words that may be misread; the text it resolves with is imported (null cancels the
   * import with ImportCancelledError). Without words to check the review is not shown.
   */
  importText(
    input: ImportInput,
    onProgress?: (msg: string) => void,
    opts?: ImportOptions,
  ): Promise<string>;
  deleteText(textId: string): Promise<void>;
  inspect(textId: string, tokenIndex: number): Promise<InspectorEntry>;
  /**
   * The inspector entry of a word outside any text (Words): its Anki example sentence as the
   * context (empty when it has none), `textId` "" and `tokenIndex` -1.
   */
  inspectWord(key: string): Promise<InspectorEntry>;
  /**
   * The words of a text: its new words (see `pickTextWords`), in text order, the same set that
   * `listTexts` counts as `newTypes`. Each item carries the live card state (one batched lookup;
   * "unavailable" when Anki cannot be reached).
   */
  textWords(textId: string): Promise<TextWordItem[]>;
  /**
   * Words to decide on (Words' first view): the new words of the learner's texts, newest text
   * first, that have no card yet and are not ignored, each with a meaning when one is known.
   */
  wordsToDecide(opts?: { limit?: number }): Promise<WordInfo[]>;
  /**
   * Short translations for many tokens at once (missing keys = no translation found). A guess
   * carries a `note`: "from woord + -loos" (built from the word's parts) or "in this sentence"
   * (read off the sentence translation).
   */
  glosses(
    textId: string,
    tokenIndices: number[],
  ): Promise<Record<number, { text: string; note?: string }>>;
  /** Add the word to Anki: the deck from the language profile, or `opts.deck` (the picker). */
  addToAnki(entry: InspectorEntry, opts?: AddOptions): Promise<{ noteId: number; deck: string }>;
  /** Words Claude suggested over MCP, waiting for the learner (newest first). */
  suggestedWords(): Promise<SuggestedWord[]>;
  /**
   * Add a suggested word to Anki (the learner's click) with Claude's gloss and
   * sentence, then take it off the queue.
   */
  addSuggestedToAnki(key: string, opts?: AddOptions): Promise<{ noteId: number; deck: string }>;
  /** Take a suggestion off the queue without adding it. */
  dismissSuggestion(key: string): Promise<void>;
  /** Move the word's new card to the front of its deck, unsuspending it. */
  learnNext(entry: InspectorEntry): Promise<{ deck: string }>;
  /** Mark the word known in Anki (adding the note first if needed), then record it. */
  markKnown(entry: InspectorEntry, opts?: AddOptions): Promise<{ addedToDeck?: string }>;
  /** Drop a manual state so Anki's applies again. */
  resetWordState(key: string): Promise<void>;
  /** App-only state changes (Ignore). Marking known goes through `markKnown`. */
  setWordState(key: string, state: WordState): Promise<void>;
  recordLookup(textId: string, key: string): Promise<void>;
  /** One answered reader cloze (first answer per blank): feeds the word's app evidence. */
  recordClozeAnswer(key: string, correct: boolean, hinted: boolean): Promise<void>;
  finishSegment(
    textId: string,
    segment: number,
    outcome: { clozeAccuracy: number | null; lookupsPer100: number },
  ): Promise<StaircaseState>;
  getSettings(): Promise<Settings>;
  saveSettings(patch: Partial<Settings>): Promise<void>;
  ankiStatus(): Promise<AnkiStatus>;
  /** Show Anki's "allow this site?" dialog (user action only), then re-test the connection. */
  connectAnki(): Promise<AnkiConnectResult>;
  syncAnki(onProgress?: (msg: string) => void): Promise<LearnerSummary>;
  learnerSummary(): Promise<LearnerSummary>;
  /** The last `days` (default 7) local days of pages read, exercises answered and words added. */
  activity(days?: number): Promise<ActivityDay[]>;
  /** Counts for the Practice start screen, the sidebar badge and Progress. */
  practiceOverview(): Promise<PracticeOverview>;
  /**
   * Build a session: due items first, then new ones, from words you are learning or know.
   * Never writes to Anki.
   */
  startPractice(opts?: PracticeOptions): Promise<Exercise[]>;
  /** Grade an answer, schedule the (word, skill) pair and record it. */
  answerExercise(exercise: Exercise, attempt: AttemptInput): Promise<AnswerResult>;
  /**
   * Grammar constructions in a text: detected once by the language server, then stored
   * with the analysis. Rejects when they are not stored and the server cannot be reached.
   */
  textGrammar(textId: string): Promise<GrammarHit[]>;
  /** Hit counts per topic over the Library's analysed texts. */
  grammarOverview(): Promise<GrammarOverview>;
  /** Examples for a topic page: the learner's own texts first, then Tatoeba. */
  grammarExamples(detects: string[], opts?: { limit?: number }): Promise<TopicExamples>;
  /** A practice session for one grammar topic, from sentences in which it was detected. */
  startTopicPractice(opts: TopicPracticeOptions): Promise<Exercise[]>;
  words(opts?: {
    state?: WordState;
    /** Only these lemma keys (Words filtered by a text, a course unit or a practice session). */
    keys?: string[];
    query?: string;
    limit?: number;
    offset?: number;
  }): Promise<WordInfo[]>;
}
