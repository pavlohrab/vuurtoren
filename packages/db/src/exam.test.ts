import { describe, expect, it } from "vitest";
import { createNodeDriver } from "./node.js";
import { createRepository } from "./repository.js";

describe("exam attempts", () => {
  it("fold ExamAttempt per language, oldest first, and survive rebuild", async () => {
    const repo = await createRepository(await createNodeDriver());
    const base = {
      type: "ExamAttempt" as const,
      exam: "nl-a2",
      mode: "exam" as const,
      setId: "set:1",
      passMark: 18,
      durationMs: 60_000,
    };
    await repo.append({
      ...base,
      lang: "nl",
      part: "knm",
      correct: 30,
      total: 40,
      passMark: 28,
      at: 2000,
    });
    await repo.append({
      ...base,
      lang: "nl",
      part: "lezen",
      correct: 15,
      total: 25,
      at: 1000,
      missed: ["lz-1-01-a"],
      words: ["afspraak"],
    });
    await repo.append({ ...base, lang: "de", part: "lezen", correct: 1, total: 1, at: 500 });
    const check = async () => {
      const list = await repo.examAttempts("nl");
      expect(list.map((a) => a.part)).toEqual(["lezen", "knm"]);
      expect(list[0]).toMatchObject({ missed: ["lz-1-01-a"], words: ["afspraak"], correct: 15 });
      expect(list[1]).toMatchObject({ missed: [], words: [], passMark: 28 });
    };
    await check();
    await repo.rebuild();
    await check();
  });
});
