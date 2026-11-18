/**
 * Exam preparation (docs/exam.md): folds ExamAttempt events into a list of attempts. Pure and
 * table-free like generated.ts, so no schema migration is needed and the local and HTTP
 * repositories answer the same way.
 */
import type { ExamAttemptRecord, StoredEvent } from "./types.js";

/** Attempts of `lang` (all exams), oldest first. */
export function projectExamAttempts(
  events: readonly StoredEvent[],
  lang: string,
): ExamAttemptRecord[] {
  const out: ExamAttemptRecord[] = [];
  for (const { id, event: e } of events) {
    if (e.type !== "ExamAttempt" || e.lang !== lang) continue;
    out.push({
      id,
      exam: e.exam,
      part: e.part,
      mode: e.mode,
      setId: e.setId,
      correct: e.correct,
      total: e.total,
      passMark: e.passMark,
      durationMs: e.durationMs,
      at: e.at,
      missed: e.missed ?? [],
      words: e.words ?? [],
    });
  }
  return out.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
}
