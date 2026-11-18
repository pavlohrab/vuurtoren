/**
 * Course model (docs/design/courses.md): a user-supplied book becomes units, blocks of OCR'd
 * text, book exercises and unit words. Pure data; persisted as events by packages/db
 * (`CourseImported`, `UnitDefined`, ...). Nothing here ever ships content of a book.
 */

/** One OCR'd page as delivered by the server's `/course/ocr` job. */
export interface OcrPage {
  /** 1-based page index within the uploaded file. */
  n: number;
  text: string;
  /** Mean word confidence 0..1. */
  confidence?: number;
  /** Layout blocks in reading order; box values are fractions of the page. */
  blocks?: { text: string; x: number; y: number; w: number; h: number }[];
}

export type CourseSourceKind = "pdf" | "images" | "text" | "url";

export interface Course {
  id: string;
  title: string;
  lang: string;
  level?: string;
  source: { kind: CourseSourceKind; filename?: string };
  /** Number of pages (or images) in the source. */
  pageCount: number;
  created: number;
}

/** What a unit of the outline is: a themed chapter, or one of the book's appendices. */
export type UnitKind = "theme" | "grammar" | "transcripts" | "wordlist" | "other";

export interface Unit {
  courseId: string;
  /** Position in the outline (1-based, unique within the course). */
  n: number;
  title: string;
  /** First and last page, inclusive. */
  pages: [number, number];
  /** Anki deck names mapped to this unit. */
  ankiDecks: string[];
  kind: UnitKind;
}

export type BlockKind = "text" | "exercise" | "wordlist" | "grammar" | "transcript" | "other";

/** A contiguous piece of a page: a reading text, one exercise, a word-list column, ... */
export interface Block {
  page: number;
  kind: BlockKind;
  /** Header that opened the block ("Oefening 3", "Tekst", ...), when detected. */
  label?: string;
  /** Exercise number for `exercise` blocks. */
  number?: number;
  text: string;
}

export type ExerciseType =
  | "gapfill"
  | "conjugation-table"
  | "sentence-building"
  | "choice"
  | "matching"
  | "open-task"
  | "listening"
  | "unknown";

/** Where an item's answer came from ("ai": a generated exercise whose sentence passed the checks). */
export type AnswerSource = "book" | "derived" | "user" | "ai";

export interface ExerciseItem {
  /** The item as printed, with blanks normalised to `____`. */
  prompt: string;
  /** Lemma or other hint in brackets. */
  hint?: string;
  /** Expected answer (the filled blank, or the full sentence for sentence-building). */
  answer?: string;
  answerSource: AnswerSource;
  /** 0..1; derived answers below {@link LOW_CONFIDENCE} are flagged in the UI. */
  confidence: number;
  /** Other accepted answers (e.g. other valid word orders). */
  accept?: string[];
  /** Word chunks for sentence building, in the printed (scrambled) order. */
  chunks?: string[];
  /** Options for choice items. */
  options?: string[];
  /** Fixed grammatical person (conjugation tables), instead of detecting the subject. */
  person?: "ik" | "jij" | "hij" | "wij" | "jullie" | "zij";
  /** Sentence building: the chunk that must start the sentence ("begin met de hoofdletter"). */
  first?: string;
  /** Tense implied by the cues ("present" | "past" | "perfect"), for derived gap-fills. */
  tense?: "present" | "past" | "perfect";
}

export const LOW_CONFIDENCE = 0.6;

export interface BookExercise {
  /** The book's own number ("Oefening 12" -> 12). */
  number: number;
  page: number;
  instruction: string;
  type: ExerciseType;
  /** The worked example ("Voorbeeld"), if any. */
  example?: string;
  items: ExerciseItem[];
  /** Raw OCR text of the exercise, shown for `unknown` and as a fallback. */
  raw: string;
  /** Linked grammar topic id, when known. */
  grammar?: string;
  /** A reading passage the items ask about (generated "questions about a text"). */
  passage?: string;
}

export interface UnitWord {
  lemma: string;
  article?: string;
  pos?: string;
  gloss?: string;
  source: "wordlist" | "anki" | "text";
}
