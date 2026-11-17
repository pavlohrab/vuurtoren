import type { Block, BookExercise, Course, Unit } from "@app/core";
import { afterEach, describe, expect, it } from "vitest";
import { createNodeDriver } from "./node.js";
import { PROJECTION_TABLES } from "./schema.js";
import { createRepository, type KenningRepository } from "./repository.js";
import type { SqlDriver } from "./types.js";

const open: KenningRepository[] = [];
afterEach(async () => {
  for (const r of open.splice(0)) await r.close().catch(() => undefined);
});

async function newRepo(): Promise<{ repo: KenningRepository; driver: SqlDriver }> {
  let t = 5_000;
  const driver = await createNodeDriver();
  const repo = await createRepository(driver, { deviceId: "dev1", now: () => t++ });
  open.push(repo);
  return { repo, driver };
}

// Synthetic fixtures only: invented sentences, no real book content.
const course: Course = {
  id: "c1",
  title: "Voorbeeldcursus",
  lang: "nl",
  source: { kind: "pdf", filename: "voorbeeld.pdf" },
  pageCount: 10,
  created: 1,
};
const units: Unit[] = [
  { courseId: "c1", n: 1, title: "Thema 1", pages: [1, 5], ankiDecks: [], kind: "theme" },
  { courseId: "c1", n: 2, title: "Thema 2", pages: [6, 10], ankiDecks: [], kind: "theme" },
];
const blocks: Block[] = [
  { page: 1, kind: "text", text: "Anne woont in Utrecht." },
  { page: 2, kind: "exercise", number: 1, label: "Oefening 1", text: "Anne _____ (wonen)." },
];
const exercise = (number: number): BookExercise => ({
  number,
  page: 2,
  instruction: "Vul in.",
  type: "gapfill",
  raw: "Anne _____ (wonen).",
  items: [
    {
      prompt: "Anne ____ (wonen).",
      hint: "wonen",
      answer: "woont",
      answerSource: "derived",
      confidence: 0.9,
    },
  ],
});

async function seed(repo: KenningRepository): Promise<void> {
  await repo.append({ type: "CourseImported", course });
  await repo.append({ type: "UnitDefined", courseId: "c1", units });
  await repo.append({ type: "BlocksExtracted", courseId: "c1", blocks });
  await repo.append({
    type: "BookExerciseExtracted",
    courseId: "c1",
    unitN: 1,
    exercises: [exercise(1), exercise(2)],
  });
  await repo.append({
    type: "UnitWordsSet",
    courseId: "c1",
    unitN: 1,
    words: [{ lemma: "wonen", source: "wordlist" }],
  });
}

describe("course projections", () => {
  it("stores a course with its outline, blocks, exercises and words", async () => {
    const { repo } = await newRepo();
    await seed(repo);
    const [c] = await repo.courses();
    expect(c?.title).toBe("Voorbeeldcursus");
    expect(c?.units.map((u) => u.n)).toEqual([1, 2]);
    expect(await repo.courseBlocks("c1")).toEqual(blocks);
    expect((await repo.unitExercises("c1", 1)).map((x) => x.number)).toEqual([1, 2]);
    expect(await repo.unitWords("c1", 1)).toEqual([{ lemma: "wonen", source: "wordlist" }]);
  });

  it("applies unit and exercise edits and keeps the newest answer", async () => {
    const { repo } = await newRepo();
    await seed(repo);
    await repo.append({
      type: "UnitEdited",
      courseId: "c1",
      n: 2,
      patch: { title: "Thema 2 Eten", ankiDecks: ["Deck::Thema 2"] },
    });
    await repo.append({
      type: "BookExerciseEdited",
      courseId: "c1",
      unitN: 1,
      number: 1,
      patch: {
        items: [
          { prompt: "Anne ____ (wonen).", answer: "woont", answerSource: "user", confidence: 1 },
        ],
      },
    });
    const answer = (answerText: string, at: number) =>
      repo.append({
        type: "BookExerciseAnswered",
        courseId: "c1",
        unitN: 1,
        number: 1,
        item: 0,
        answer: answerText,
        correct: answerText === "woont",
        at,
      });
    await answer("woont", 200);
    await answer("wont", 100); // older answer arriving late must not win
    const [c] = await repo.courses();
    expect(c?.units[1]).toMatchObject({ title: "Thema 2 Eten", ankiDecks: ["Deck::Thema 2"] });
    expect((await repo.unitExercises("c1", 1))[0]?.items[0]?.answerSource).toBe("user");
    expect(await repo.bookAnswers("c1", 1)).toEqual([
      { unitN: 1, number: 1, item: 0, answer: "woont", correct: true, at: 200 },
    ]);
  });

  it("re-extraction replaces a unit's exercises; events for unknown courses are ignored", async () => {
    const { repo } = await newRepo();
    await seed(repo);
    await repo.append({
      type: "BookExerciseExtracted",
      courseId: "c1",
      unitN: 1,
      exercises: [exercise(7)],
    });
    expect((await repo.unitExercises("c1", 1)).map((x) => x.number)).toEqual([7]);
    await repo.append({ type: "UnitDefined", courseId: "ghost", units });
    expect(await repo.courses()).toHaveLength(1);
  });

  it("deleting a course removes all of its rows", async () => {
    const { repo } = await newRepo();
    await seed(repo);
    await repo.append({ type: "CourseDeleted", courseId: "c1" });
    expect(await repo.courses()).toEqual([]);
    expect(await repo.courseBlocks("c1")).toEqual([]);
    expect(await repo.unitExercises("c1", 1)).toEqual([]);
  });

  it("rebuild reproduces the projections exactly", async () => {
    const { repo, driver } = await newRepo();
    await seed(repo);
    await repo.append({
      type: "UnitEdited",
      courseId: "c1",
      n: 1,
      patch: { pages: [1, 4] },
    });
    await repo.append({
      type: "BookExerciseAnswered",
      courseId: "c1",
      unitN: 1,
      number: 2,
      item: 0,
      answer: "woont",
      correct: true,
      at: 9,
    });
    const dump = async () =>
      Promise.all(
        PROJECTION_TABLES.filter((t) => /course|book_|unit_/.test(t)).map((t) =>
          driver.exec(`SELECT * FROM ${t} ORDER BY 1, 2, 3`),
        ),
      );
    const before = await dump();
    expect(before.flat().length).toBeGreaterThan(5);
    await repo.rebuild();
    expect(await dump()).toEqual(before);
  });
});
