/** Exam preparation over the repository: attempts as ExamAttempt events. */
import type { VuurtorenRepository } from "@app/db";
import type { ExamServices } from "./examTypes.js";

export interface LiveExamDeps {
  repo: Pick<VuurtorenRepository, "append" | "examAttempts">;
  lang: () => Promise<string>;
  /** Called after a write (invalidates cached derived data). */
  changed?: () => void;
  now?: () => number;
}

export function createLiveExam(
  deps: LiveExamDeps,
): Pick<ExamServices, "examAttempts" | "recordExamAttempt"> {
  const now = deps.now ?? Date.now;
  return {
    async examAttempts() {
      return deps.repo.examAttempts(await deps.lang());
    },
    async recordExamAttempt(input) {
      await deps.repo.append({
        type: "ExamAttempt",
        lang: await deps.lang(),
        exam: "nl-a2",
        part: input.part,
        mode: input.mode,
        setId: input.setId,
        correct: input.correct,
        total: input.total,
        passMark: input.passMark,
        durationMs: Math.max(0, Math.round(input.durationMs)),
        at: now(),
        ...(input.missed?.length ? { missed: input.missed } : {}),
        ...(input.words?.length ? { words: input.words } : {}),
      });
      deps.changed?.();
    },
  };
}
