import { describe, expect, it } from "vitest";
import { createNodeDriver } from "./node.js";
import { composeWord } from "./projections.js";
import { createRepository } from "./repository.js";
import type { AppEvent } from "./types.js";

const T = 1_700_000_000_000;
const DAY = 86_400_000;

async function repoAt(clock: { t: number }) {
  return createRepository(await createNodeDriver(), { deviceId: "d", now: () => clock.t });
}

const cloze = (key: string, correct: boolean, at: number, hinted = false): AppEvent => ({
  type: "ClozeAnswered",
  lang: "nl",
  key,
  correct,
  hinted,
  at,
});
const practice = (key: string, correct: boolean, at: number): AppEvent => ({
  type: "ExerciseAnswered",
  lang: "nl",
  key,
  skill: "recognition",
  kind: "meaning-choice",
  grade: correct ? "good" : "again",
  correct,
  ms: 900,
  at,
  state: { key, skill: "recognition" } as never,
});
const snapshot = (
  entries: { key: string; state: "known" | "unknown" | "learning"; pKnown: number }[],
): AppEvent => ({
  type: "AnkiSnapshotImported",
  lang: "nl",
  entries: entries.map((e) => ({ ...e, noteIds: [1], decks: ["D"] })),
  sources: ["D"],
});

describe("learning signals", () => {
  it("practice, cloze and book answers raise a word Anki does not know", async () => {
    const clock = { t: T };
    const repo = await repoAt(clock);
    await repo.append(snapshot([{ key: "fiets", state: "unknown", pKnown: 0 }]));
    await repo.append(practice("fiets", true, T - 3000));
    await repo.append(cloze("fiets", true, T - 2000));
    expect(await repo.word("nl", "fiets")).toMatchObject({ state: "unknown", source: "anki" });
    await repo.append({
      type: "BookExerciseAnswered",
      courseId: "c",
      unitN: 1,
      number: 1,
      item: 0,
      answer: "fiets",
      correct: true,
      at: T - 1000,
      lang: "nl",
      keys: ["fiets"],
    });
    const w = await repo.word("nl", "fiets");
    expect(w).toMatchObject({ state: "learning", appLearning: true, source: "anki" });
    expect(w?.evidence).toEqual({ correct: 3, wrong: 0, lastAt: T - 1000 });
    expect(w?.pKnown).toBeCloseTo(0.6);
    expect((await repo.learnerModel("nl")).get("fiets")?.state).toBe("learning");
    // Faded after two months without answers: back to Anki's state, pKnown still raised a bit.
    clock.t = T + 60 * DAY;
    const later = await repo.word("nl", "fiets");
    expect(later?.state).toBe("unknown");
    expect(later?.appLearning).toBeUndefined();
    await repo.close();
  });

  it("never demotes an Anki-known word and never overrides a manual mark", async () => {
    const repo = await repoAt({ t: T });
    await repo.append(snapshot([{ key: "huis", state: "known", pKnown: 0.9 }]));
    for (let i = 0; i < 5; i++) await repo.append(cloze("huis", false, T - i));
    expect(await repo.word("nl", "huis")).toMatchObject({ state: "known", pKnown: 0.9 });
    await repo.append({ type: "WordStateSet", lang: "nl", key: "boom", state: "unknown" });
    for (let i = 0; i < 5; i++) await repo.append(practice("boom", true, T - i));
    expect(await repo.word("nl", "boom")).toMatchObject({ state: "unknown", pKnown: 0 });
    await repo.close();
  });

  it("is the same whatever order the answers arrive in, and after a rebuild", async () => {
    const events = [
      cloze("kat", true, T - 50, true),
      practice("kat", false, T - 40),
      cloze("kat", true, T - 30),
      practice("kat", true, T - 20),
    ];
    const a = await repoAt({ t: T });
    const b = await repoAt({ t: T });
    for (const e of events) await a.append(e);
    for (const e of [...events].reverse()) await b.append(e);
    const wa = await a.word("nl", "kat");
    expect(await b.word("nl", "kat")).toEqual(wa);
    expect(wa?.evidence).toEqual({ correct: 2.5, wrong: 1, lastAt: T - 20 });
    await a.rebuild();
    expect(await a.word("nl", "kat")).toEqual(wa);
    await a.close();
    await b.close();
  });

  it("composeWord: a word met only in exercises is seen, with its evidence", () => {
    const info = composeWord(
      "eend",
      { lookups: 0, evidence: { correct: 1, wrong: 0, lastAt: T, lastCorrect: true } },
      T,
    );
    expect(info).toMatchObject({ state: "seen", source: "app" });
    expect(info?.pKnown).toBeCloseTo(0.4);
  });
});
