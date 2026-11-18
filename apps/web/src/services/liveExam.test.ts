import { describe, expect, it, vi } from "vitest";
import { createRepository } from "@app/db";
import { createNodeDriver } from "@app/db/node";
import { createLiveExam } from "./liveExam.js";

describe("live exam service", () => {
  it("records ExamAttempt events in the current language and lists them", async () => {
    const repo = await createRepository(await createNodeDriver(":memory:"));
    const changed = vi.fn();
    const exam = createLiveExam({ repo, lang: async () => "nl", changed, now: () => 1234 });
    await exam.recordExamAttempt({
      part: "knm",
      mode: "exam",
      setId: "set:1",
      correct: 30,
      total: 40,
      passMark: 28,
      durationMs: 1000.4,
      missed: [],
      words: ["huurtoeslag"],
    });
    expect(changed).toHaveBeenCalledOnce();
    const events = await repo.events();
    expect(events.at(-1)!.event).toEqual({
      type: "ExamAttempt",
      lang: "nl",
      exam: "nl-a2",
      part: "knm",
      mode: "exam",
      setId: "set:1",
      correct: 30,
      total: 40,
      passMark: 28,
      durationMs: 1000,
      at: 1234,
      words: ["huurtoeslag"],
    });
    expect(await exam.examAttempts()).toMatchObject([{ part: "knm", correct: 30, missed: [] }]);
  });
});
