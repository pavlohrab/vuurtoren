import { describe, expect, it } from "vitest";
import { createNodeDriver } from "./node.js";
import { createRepository } from "./repository.js";

const T = 1_700_000_000_000;

describe("practice lessons data (algorithms.md 4.7)", () => {
  it("keeps every practice answer in order, a hinted right one as half", async () => {
    const clock = { t: T };
    const repo = await createRepository(await createNodeDriver(), {
      deviceId: "d",
      now: () => clock.t,
    });
    const answer = (key: string, kind: string, grade: "again" | "hard" | "good", at: number) =>
      repo.append({
        type: "ExerciseAnswered",
        lang: "nl",
        key,
        skill: "form",
        kind: kind as never,
        grade,
        correct: grade !== "again",
        ms: 900,
        at,
        state: { key, skill: "form" } as never,
      });
    await answer("huis", "scramble", "good", T + 2);
    await answer("fiets", "gender", "again", T + 1);
    await answer("huis", "cloze-typed", "hard", T + 3);
    expect(await repo.practiceAnswers("nl")).toEqual([
      { key: "fiets", kind: "gender", result: 0, at: T + 1 },
      { key: "huis", kind: "scramble", result: 1, at: T + 2 },
      { key: "huis", kind: "cloze-typed", result: 0.5, at: T + 3 },
    ]);
  });

  it("remembers when a word was last tapped", async () => {
    const clock = { t: T };
    const repo = await createRepository(await createNodeDriver(), {
      deviceId: "d",
      now: () => clock.t,
    });
    await repo.append({ type: "WordLookedUp", lang: "nl", key: "gracht", textId: "t1" });
    clock.t = T + 5000;
    await repo.append({ type: "WordLookedUp", lang: "nl", key: "gracht", textId: "t1" });
    const w = await repo.word("nl", "gracht");
    expect(w).toMatchObject({ lookups: 2, lastLookupAt: T + 5000 });
  });
});
