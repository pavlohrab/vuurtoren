/** In-memory exam attempts for the demo build and UI tests. */
import type { ExamAttemptRecord, ExamServices } from "./examTypes.js";

const DAY = 86_400_000;

/** A demo history: one mock exam and two practice rounds in the past week. */
export function demoAttempts(now = Date.now()): ExamAttemptRecord[] {
  const base = { exam: "nl-a2", missed: [], words: [] };
  return [
    {
      ...base,
      id: "demo-1",
      part: "knm",
      mode: "practice",
      setId: "theme:wonen",
      correct: 9,
      total: 11,
      passMark: 8,
      durationMs: 240_000,
      at: now - 5 * DAY,
    },
    {
      ...base,
      id: "demo-2",
      part: "lezen",
      mode: "exam",
      setId: "set:1",
      correct: 19,
      total: 25,
      passMark: 18,
      durationMs: 2_900_000,
      at: now - 3 * DAY,
      words: ["afspraak", "ophalen"],
    },
    {
      ...base,
      id: "demo-3",
      part: "luisteren",
      mode: "practice",
      setId: "set:1",
      correct: 14,
      total: 24,
      passMark: 18,
      durationMs: 1_200_000,
      at: now - DAY,
    },
  ];
}

export function createMockExam(
  wait: () => Promise<void>,
  seed: ExamAttemptRecord[] = [],
): Pick<ExamServices, "examAttempts" | "recordExamAttempt"> {
  const attempts = [...seed];
  return {
    async examAttempts() {
      await wait();
      return [...attempts];
    },
    async recordExamAttempt(input) {
      await wait();
      attempts.push({
        id: `m${attempts.length + 1}`,
        exam: "nl-a2",
        ...input,
        missed: input.missed ?? [],
        words: input.words ?? [],
        at: Date.now(),
      });
    },
  };
}
