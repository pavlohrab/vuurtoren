/** Contract of the exam-preparation services (docs/exam.md). */
import type { ExamFeedback, ExamFeedbackInput, ExamItemPart, GeneratedExamItem } from "@app/ai";
import type { ExamPart } from "@app/content";
import type { ExamAttemptRecord } from "@app/db";

export type { ExamAttemptRecord, ExamFeedback, ExamFeedbackInput, ExamItemPart, GeneratedExamItem };

/** One finished practice round or mock exam, as recorded. */
export interface ExamAttemptInput {
  part: ExamPart;
  mode: "exam" | "practice";
  /** "set:1", "theme:wonen", "task:sc-1-02", "ai". */
  setId: string;
  correct: number;
  total: number;
  passMark: number;
  durationMs: number;
  missed?: string[];
  words?: string[];
}

/** A generated Lezen/Luisteren item with its vocabulary check. */
export interface GeneratedExamView {
  item: GeneratedExamItem;
  /** Share of known words, null when the language server was unavailable. */
  coverage: number | null;
  rewritten: boolean;
}

export interface ExamServices {
  /** Finished sessions of the current language, oldest first. */
  examAttempts(): Promise<ExamAttemptRecord[]>;
  recordExamAttempt(input: ExamAttemptInput): Promise<void>;
  /**
   * A new A2 practice item around your vocabulary (needs an AI provider). Rejects when the
   * provider fails or returns no usable item. Not stored.
   */
  generateExamItem(part: ExamItemPart, topic?: string): Promise<GeneratedExamView>;
  /** Examiner-style feedback on a written answer or a typed spoken answer (needs a provider). */
  examFeedback(input: ExamFeedbackInput): Promise<ExamFeedback>;
}
