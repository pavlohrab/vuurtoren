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
import type { StoredText, TextSummary, WordInfo } from "@app/db";
import type { InspectorEntry } from "@app/ui";
import type { AIServices } from "./aiTypes.js";

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
  /** Why it is listed: highlighted as new, looked up while reading, or only translated. */
  source: "introduce" | "lookup" | "gloss";
  /** Same entry the word inspector uses, so addToAnki / learnNext / markKnown work unchanged. */
  entry: InspectorEntry;
}
export interface TextListItem extends TextSummary {
  coverage: number | null;
  newTypes: number | null;
}
export interface Settings {
  ankiUrl: string;
  ankiKey?: string;
  nlpUrl: string;
  lang: "nl";
  targetDeck: string;
  theme: "system" | "light" | "dark";
  /** Reader help dial in [0, 1]: which words get an inline translation (see core help.ts). */
  help: number;
  /** New words introduced per 300 words: "auto" follows the adaptive staircase. */
  newWords: number | "auto";
  /** Gloss mode: also show cloze blanks (off by default). */
  glossClozes: boolean;
  /** Reader: underline grammar constructions (spotlights). Off by default. */
  grammarSpotlights: boolean;
}
export type ImportInput =
  | { kind: "paste"; title?: string; content: string }
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
export interface AnkiConnectResult {
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
}

/**
 * Everything the UI needs from the outside world. The app never talks to the database,
 * AnkiConnect or the NLP server directly; swap the implementation passed to <ServicesProvider>.
 */
export interface AppServices extends AIServices {
  listTexts(): Promise<TextListItem[]>;
  getReading(textId: string): Promise<ReadingView | null>;
  importText(input: ImportInput, onProgress?: (msg: string) => void): Promise<string>;
  deleteText(textId: string): Promise<void>;
  inspect(textId: string, tokenIndex: number): Promise<InspectorEntry>;
  /**
   * Words worth reviewing after reading a text, in text order: every highlighted ("introduce")
   * word of any page plus the words looked up in this text, optionally also the translated-only
   * ("gloss") words. Known, ignored and non-words are left out. Each item carries the live
   * Anki state (one batched lookup; "unavailable" when Anki cannot be reached).
   */
  textWords(textId: string, opts?: { includeGlossed?: boolean }): Promise<TextWordItem[]>;
  /** Short translations for many tokens at once (missing keys = no translation found). */
  glosses(textId: string, tokenIndices: number[]): Promise<Record<number, string>>;
  addToAnki(entry: InspectorEntry): Promise<{ noteId: number; deck: string }>;
  /** Move the word's new card to the front of its deck, unsuspending it (ADR 0007). */
  learnNext(entry: InspectorEntry): Promise<{ deck: string }>;
  /** Mark the word known in Anki (adding the note first if needed), then record it (ADR 0007). */
  markKnown(entry: InspectorEntry): Promise<{ addedToDeck?: string }>;
  /** Drop a manual state so Anki's applies again. */
  resetWordState(key: string): Promise<void>;
  /** App-only state changes (Ignore). Marking known goes through `markKnown`. */
  setWordState(key: string, state: WordState): Promise<void>;
  recordLookup(textId: string, key: string): Promise<void>;
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
  /** Counts for the Practice start screen, the sidebar badge and Progress. */
  practiceOverview(): Promise<PracticeOverview>;
  /**
   * Build a session: due items first, then new ones, from words you are learning or know.
   * Never writes to Anki (ADR 0003).
   */
  startPractice(opts?: { size?: number; skills?: Skill[] }): Promise<Exercise[]>;
  /** Grade an answer, schedule the (word, skill) pair and record it. */
  answerExercise(exercise: Exercise, attempt: AttemptInput): Promise<AnswerResult>;
  /**
   * Grammar constructions in a text (M5): detected once by the language server, then stored
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
    query?: string;
    limit?: number;
    offset?: number;
  }): Promise<WordInfo[]>;
}
