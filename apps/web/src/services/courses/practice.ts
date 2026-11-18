/** Unit practice ("more like this") and the book exercises: checking and editing answers. */
import {
  type BookExercise,
  type Exercise,
  type ExerciseKind,
  type ItemCheck,
  bookItemKeys,
  checkBookItem,
  isVerbSecond,
} from "@app/core";
import type { WordInfo } from "@app/db";
import { createRng, generate, shuffle } from "../../practice/engine.js";
import type { BookCheckResult, CourseServices } from "../courseTypes.js";
import type { CourseContext } from "./context.js";

const MAX_PRACTICE_WORDS = 60;

/** Kinds of the practice engine that imitate each book exercise type ("more like this"). */
const KINDS_FOR_TYPE: Partial<Record<BookExercise["type"], ExerciseKind[]>> = {
  gapfill: ["verb-form", "perfect", "cloze-typed"],
  "conjugation-table": ["verb-form"],
  "sentence-building": ["scramble"],
  choice: ["cloze-choice", "word-choice"],
};

export function createCoursePractice(ctx: CourseContext) {
  const { deps, repo, clock, courseOrThrow, keyOf, wordMap } = ctx;

  /** Keys of the unit's words plus the words of earlier units (for review), unit words first. */
  async function practiceKeys(
    courseId: string,
    n: number,
  ): Promise<{ unit: string[]; earlier: string[] }> {
    const course = await courseOrThrow(courseId);
    const unit = (await repo.unitWords(courseId, n)).map(keyOf);
    const earlier: string[] = [];
    for (const u of course.units) {
      if (u.kind === "theme" && u.n < n)
        earlier.push(...(await repo.unitWords(courseId, u.n)).map(keyOf));
    }
    return { unit, earlier: earlier.filter((k) => !unit.includes(k)) };
  }

  async function generateFor(
    courseId: string,
    n: number,
    kinds: ExerciseKind[],
    size: number,
  ): Promise<Exercise[]> {
    const { unit, earlier } = await practiceKeys(courseId, n);
    const infos = await wordMap();
    // Two thirds from this unit, the rest review of earlier units.
    const reviewKeys = earlier.slice(-Math.ceil(MAX_PRACTICE_WORDS / 3));
    const keys = [...unit.slice(0, MAX_PRACTICE_WORDS), ...reviewKeys];
    if (keys.length === 0) return [];
    const words = await deps.wordData(
      (await deps.settings()).lang,
      keys.map((key) => ({ key, info: infos.get(key) ?? null })),
    );
    const rng = createRng(clock());
    const out: Exercise[] = [];
    // Shuffle the words (unit words first, then review) so each run picks different ones;
    // before, the same first words came out every time.
    const unitSet = new Set(unit);
    const order = [
      ...shuffle(
        words.filter((w) => unitSet.has(w.key)),
        rng,
      ),
      ...shuffle(
        words.filter((w) => !unitSet.has(w.key)),
        rng,
      ),
    ];
    const startKind = Math.floor(rng() * kinds.length);
    // Round-robin over words and kinds so a session spreads out.
    for (let round = 0; out.length < size && round < kinds.length * 2; round++) {
      for (const w of order) {
        if (out.length >= size) break;
        const kind = kinds[(startKind + round + out.length) % kinds.length];
        const ex = kind ? generate(kind, w, words, rng) : null;
        if (ex && !out.some((o) => o.key === ex.key && o.kind === ex.kind)) out.push(ex);
      }
    }
    return out;
  }

  const ALL_KINDS: ExerciseKind[] = [
    "meaning-choice",
    "cloze-typed",
    "verb-form",
    "cloze-choice",
    "gender",
    "perfect",
    "scramble",
  ];

  async function unitPractice(
    courseId: string,
    n: number,
    opts: { size?: number } = {},
  ): Promise<Exercise[]> {
    return generateFor(courseId, n, ALL_KINDS, opts.size ?? 12);
  }

  async function moreLikeThis(courseId: string, n: number, number: number): Promise<Exercise[]> {
    const ex = (await repo.unitExercises(courseId, n)).find((e) => e.number === number);
    const kinds = (ex && KINDS_FOR_TYPE[ex.type]) ?? ALL_KINDS;
    return generateFor(courseId, n, kinds, 8);
  }

  /** A book exercise, or one generated for the unit (numbers from 1001). */
  async function findExercise(courseId: string, n: number, number: number) {
    const own = (await repo.unitExercises(courseId, n)).find((e) => e.number === number);
    return own ?? (await repo.generatedUnitExercises(courseId, n)).find((e) => e.number === number);
  }

  async function checkItem(
    courseId: string,
    n: number,
    number: number,
    item: number,
    answer: string,
  ): Promise<BookCheckResult> {
    const ex = await findExercise(courseId, n, number);
    const it = ex?.items[item];
    if (!ex || !it) throw new Error("This exercise item no longer exists.");
    let orderOk: boolean | undefined;
    if (ex.type === "sentence-building" && answer.trim()) {
      try {
        const [parsed] = await (await deps.nlp()).analyzeText("nl", [answer]);
        orderOk = parsed ? isVerbSecond(parsed.tokens) : undefined;
      } catch {
        // Word-order check is optional: the answer is graded without it.
        orderOk = undefined;
      }
    }
    const result: ItemCheck = checkBookItem(ex.type, it, answer, orderOk);
    // The words the item tests, so a marked answer teaches the learner model (ADR 0011).
    const course = await courseOrThrow(courseId);
    const unitKeys = new Set((await repo.unitWords(courseId, n)).map(keyOf));
    const infos: Map<string, WordInfo> = result.correct === null ? new Map() : await wordMap();
    const keys =
      result.correct === null
        ? []
        : bookItemKeys(ex.type, it, (k) => unitKeys.has(k) || infos.has(k));
    // An item without a stored answer cannot be marked; the answer is still remembered.
    await repo.append({
      type: "BookExerciseAnswered",
      courseId,
      unitN: n,
      number,
      item,
      answer,
      correct: result.correct === true,
      at: clock(),
      ...(keys.length > 0 ? { lang: course.lang, keys } : {}),
    });
    deps.changed();
    return { ...result, ...(it.answer && result.correct !== true ? { expected: it.answer } : {}) };
  }

  async function setBookAnswer(
    courseId: string,
    n: number,
    number: number,
    item: number,
    answer: string,
  ): Promise<void> {
    const ex = (await repo.unitExercises(courseId, n)).find((e) => e.number === number);
    if (!ex?.items[item]) throw new Error("This exercise item no longer exists.");
    const items = ex.items.map((it, i) =>
      i === item
        ? { ...it, answer: answer.trim(), answerSource: "user" as const, confidence: 1 }
        : it,
    );
    await repo.append({ type: "BookExerciseEdited", courseId, unitN: n, number, patch: { items } });
  }

  return {
    unitPractice,
    moreLikeThis,
    checkBookItem: checkItem,
    setBookAnswer,
    async editBookExercise(
      courseId: string,
      n: number,
      number: number,
      patch: Parameters<CourseServices["editBookExercise"]>[3],
    ) {
      await repo.append({ type: "BookExerciseEdited", courseId, unitN: n, number, patch });
    },
  } satisfies Partial<CourseServices>;
}
