/**
 * Course services contract (docs/design/courses.md). Implemented by liveCourses.ts (database +
 * NLP server + Anki) and mockCourses.ts (demo data); the UI only sees this interface.
 */
import type {
  Block,
  BookExercise,
  Course,
  Exercise,
  ExerciseItem,
  ItemCheck,
  Unit,
  UnitStatus,
  UnitWord,
  WordState,
} from "@app/core";

export type ImportStage = "ocr" | "outline" | "texts" | "exercises" | "done";

/** Progress callback payload of the long-running import steps. */
export interface ImportProgress {
  stage: ImportStage;
  done: number;
  total: number;
  message: string;
}

/** What can be imported as a course. */
export type CourseSourceInput =
  /** One PDF, or photos of pages (read in the given order). */
  | { kind: "pdf" | "images"; files: File[]; title?: string }
  | { kind: "text"; title: string; text: string };

export interface CourseListItem {
  course: Course;
  unitCount: number;
  /** Words known / total over all units with words (0..1), null when no unit has words. */
  knownRatio: number | null;
  /** The unit to continue with (first theme with open exercises or unknown words). */
  continueUnit: number | null;
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

export interface BookItemState {
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
  /** The unit's grammar notes: OCR'd blocks linked to the unit (for your own use). */
  grammar: { title: string; text: string }[];
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

export interface CourseServices {
  /** OCR (server job) + outline detection; saves the course and its draft outline. */
  importCourse(input: CourseSourceInput, onProgress?: (p: ImportProgress) => void): Promise<string>;
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
