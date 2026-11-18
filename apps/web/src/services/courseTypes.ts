/**
 * Course services contract (docs/design/courses.md). Implemented by liveCourses.ts (database +
 * NLP server + Anki) and mockCourses.ts (demo data); the UI only sees this interface.
 */
import type {
  Block,
  BookExercise,
  Course,
  CoursePack,
  Exercise,
  ExerciseItem,
  ItemCheck,
  PackMode,
  Unit,
  UnitStatus,
  UnitWord,
  WordState,
} from "@app/core";

type ImportStage = "ocr" | "outline" | "texts" | "exercises" | "done";

/** Progress callback payload of the long-running import steps. */
export interface ImportProgress {
  stage: ImportStage;
  done: number;
  total: number;
  message: string;
}

/** What can be imported as a course. */
export type CourseSourceInput =
  /** One PDF or EPUB, or photos of pages (read in the given order). */
  | { kind: "pdf" | "images"; files: File[]; title?: string }
  | { kind: "text"; title: string; text: string }
  /** Web pages, one unit each, in the given order. */
  | { kind: "url"; urls: string[]; title: string };

/** An import whose reading job was started but not turned into a course yet (wizard left). */
export interface PendingImport {
  jobId: string;
  title: string;
  filename: string;
  kind: "pdf" | "images";
  lang: string;
  total: number;
  startedAt: number;
}

/** First lines of one page, for the outline editor. */
export interface PagePreview {
  n: number;
  lines: string[];
}

/** One row of the "Add words to Anki" preview. */
export interface AddWordRow {
  key: string;
  lemma: string;
  article?: string;
  gloss?: string;
  /** A sentence from the book that uses the word. */
  example?: string;
  unitN: number;
  /** "new": not in Anki; "in-anki": a note exists; "known": known already (skipped). */
  status: "new" | "in-anki" | "known";
}

export interface AddWordsPreview {
  rows: AddWordRow[];
  /** Deck the words go to by the profile rule, per unit (per-unit rule) or one for all. */
  decks: Record<number, string>;
  /** The deck options of the picker. */
  options: string[];
}

/** A grammar topic the unit's texts show (rule-based detectors over the book's own texts). */
export interface UnitGrammarTopic {
  topicId: string;
  title: string;
  level: string;
  summary: string;
  /** Sentences of the unit that show it. */
  count: number;
  example?: string;
}

export interface GenerateUnitResult {
  added: number;
  rejected: number;
  grammarTopic?: string;
}

export interface CourseListItem {
  course: Course;
  unitCount: number;
  /** Words known / total over all units with words (0..1), null when no unit has words. */
  knownRatio: number | null;
  /** The unit to continue with (first theme with open exercises or unknown words). */
  continueUnit: number | null;
  /** Its title, and how much of its words are known (0..1, null without words). */
  continueTitle?: string;
  continueKnown?: number | null;
}

/** One row of the course page. */
export interface UnitRow {
  unit: Unit;
  status: UnitStatus;
}

export interface CourseView {
  course: Course;
  units: UnitRow[];
  /** Anki is reachable and a snapshot exists (unit status is based on it). */
  ankiReady: boolean;
}

/** A unit word with the learner's live state. */
export interface UnitWordView extends UnitWord {
  key: string;
  state: WordState | "absent";
  inAnki: boolean;
  /** The deck(s) of its Anki note(s). */
  decks: string[];
}

/** A reading text or transcript found in a unit, and whether it is already in the Library. */
export interface UnitText {
  label: string;
  kind: "text" | "transcript";
  page: number;
  words: number;
  /** Library text id when imported. */
  textId?: string;
}

interface BookItemState {
  /** Latest answer given, if any. */
  answer?: string;
  correct?: boolean;
}

/** A book exercise with the learner's answers per item. */
export interface BookExerciseView extends BookExercise {
  answers: BookItemState[];
}

export interface UnitView {
  course: Course;
  unit: Unit;
  status: UnitStatus;
  texts: UnitText[];
  exercises: BookExerciseView[];
  words: UnitWordView[];
  /**
   * The unit's grammar notes: OCR'd blocks linked to the unit (for your own use); every chapter
   * of a grammar unit. `topicId`: the app's topic page for the chapter, when known.
   */
  grammar: { title: string; text: string; topicId?: string }[];
  /** Exercises made for this unit with AI (validated, graded like the book's). */
  generated: BookExerciseView[];
}

/** Editable outline row (the outline editor). */
export interface OutlineRow {
  title: string;
  pages: [number, number];
  kind: Unit["kind"];
}

export interface DeckMapping {
  /** All Anki deck names (empty when Anki is unreachable). */
  decks: string[];
  /** Suggested decks per unit number. */
  suggested: Record<number, string[]>;
  /** The mapping currently saved. */
  current: Record<number, string[]>;
}

export interface BookCheckResult extends ItemCheck {
  /** The expected answer, shown when the user asks or the answer was wrong. */
  expected?: string;
}

export interface LearnNextResult {
  /** Words whose new cards moved to the front. */
  moved: number;
  /** Words with no new card (already started, or not in Anki). */
  skipped: number;
}

export interface AddMissingResult {
  added: number;
  failed: number;
  deck: string;
}

/** A course pack ready to download. */
export interface ExportedPack {
  fileName: string;
  /** The pack as JSON text. */
  json: string;
}

/** What importing a course pack did. */
export interface PackImportResult {
  courseId: string;
  units: number;
  words: number;
  exercises: number;
  /** Reading texts and transcripts added to the Library (or already there). */
  texts: number;
  /** Texts that could not be added (analysis failed, e.g. the language server is not reachable). */
  textsFailed: number;
  /** Structure packs: pack exercises found in your own import, and the ones it missed. */
  matched?: number;
  missing?: number;
  /** Structure packs: share of the pack's page fingerprint your pages match (0..1). */
  fingerprint?: number;
}

export interface CourseServices {
  /** The course as a course pack: "full" (with the book's text) or "structure" (without). */
  exportCoursePack(courseId: string, mode: PackMode): Promise<ExportedPack>;
  /**
   * Create a course from a pack (validated with `parseCoursePack`). A full pack needs nothing
   * else; a structure pack needs your own copy of the book (`files`), read like a normal import
   * (from the server's cache when it read the file before) and checked against the pack's
   * fingerprint.
   */
  importCoursePack(
    pack: CoursePack,
    opts?: { files?: File[]; onProgress?: (p: ImportProgress) => void },
  ): Promise<PackImportResult>;
  /** OCR (server job) + outline detection; saves the course and its draft outline. */
  importCourse(input: CourseSourceInput, onProgress?: (p: ImportProgress) => void): Promise<string>;
  /** The import left unfinished in this browser (its reading job id is remembered), or null. */
  pendingImport(): Promise<PendingImport | null>;
  /** Reattach to the pending reading job and finish the import (throws when the job is gone). */
  resumeImport(onProgress?: (p: ImportProgress) => void): Promise<string>;
  /** Forget the pending import (and stop its job when it still runs). */
  discardPendingImport(): Promise<void>;
  /** First lines of every page, for the outline editor. */
  pagePreviews(courseId: string): Promise<PagePreview[]>;
  /** Preview of "Add words to Anki" for a unit, or the whole course ("all"). */
  addWordsPreview(courseId: string, scope: number | "all"): Promise<AddWordsPreview>;
  /** Add words of a unit (or the whole course) to Anki: `keys` (default: all new ones). */
  addUnitWords(
    courseId: string,
    scope: number | "all",
    opts?: { keys?: string[]; deck?: string },
  ): Promise<AddMissingResult>;
  /** Grammar topics the unit's texts show, most frequent first. */
  unitGrammar(courseId: string, n: number): Promise<UnitGrammarTopic[]>;
  /** Recognise exercises, derive answers, extract word lists, add texts to the Library. */
  analyzeCourse(courseId: string, onProgress?: (p: ImportProgress) => void): Promise<void>;
  courseList(): Promise<CourseListItem[]>;
  course(courseId: string): Promise<CourseView | null>;
  deleteCourse(courseId: string): Promise<void>;
  /** The outline as the importer guessed it, for the editor. */
  outline(courseId: string): Promise<OutlineRow[]>;
  /** Replace the outline (re-assigns pages to units; call `analyzeCourse` afterwards). */
  editOutline(courseId: string, rows: OutlineRow[]): Promise<void>;
  deckMapping(courseId: string): Promise<DeckMapping>;
  mapDecks(courseId: string, mapping: Record<number, string[]>): Promise<void>;
  unit(courseId: string, n: number): Promise<UnitView | null>;
  unitStatus(courseId: string, n: number): Promise<UnitStatus>;
  /** "Learn next" for the unit's new cards (ADR 0007: explicit, logged). */
  learnNextForUnit(courseId: string, n: number): Promise<LearnNextResult>;
  /** Add the unit words that are not in Anki (the profile's course deck or `opts.deck`, tagged for the unit). */
  addMissingUnitWords(
    courseId: string,
    n: number,
    opts?: { deck?: string },
  ): Promise<AddMissingResult>;
  /** Engine session restricted to the unit's words (+ earlier units for review). */
  unitPractice(courseId: string, n: number, opts?: { size?: number }): Promise<Exercise[]>;
  /** "More like this": generated items in the style of one book exercise. */
  moreLikeThis(courseId: string, n: number, number: number): Promise<Exercise[]>;
  /** Check (and record) an answer to one item of a book exercise. */
  checkBookItem(
    courseId: string,
    n: number,
    number: number,
    item: number,
    answer: string,
  ): Promise<BookCheckResult>;
  /** Correct the stored answer of an item ("fix answer"); remembered as the user's. */
  setBookAnswer(
    courseId: string,
    n: number,
    number: number,
    item: number,
    answer: string,
  ): Promise<void>;
  /** Fix a mis-recognised exercise (type, instruction or items). */
  editBookExercise(
    courseId: string,
    n: number,
    number: number,
    patch: { type?: BookExercise["type"]; instruction?: string; items?: ExerciseItem[] },
  ): Promise<void>;
  /** Raw blocks of the unit, for the editor view and import of a missed text. */
  unitBlocks(courseId: string, n: number): Promise<Block[]>;
}
