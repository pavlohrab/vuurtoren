/** Course and unit views: word state, progress and the unit page. */
import {
  type Block,
  type BookExercise,
  type Unit,
  type UnitWord,
  readingTexts,
  unitStatus,
} from "@app/core";
import { grammarTopic } from "@app/content";
import type { WordInfo } from "@app/db";
import type {
  CourseListItem,
  CourseServices,
  CourseView,
  UnitRow,
  UnitText,
  UnitView,
  UnitWordView,
} from "../courseTypes.js";
import type { CourseContext } from "./context.js";

export function createCourseViews(ctx: CourseContext) {
  const { repo, courseOrThrow, keyOf, wordMap } = ctx;

  /** Words of a unit with the learner's live state (from the database; Anki live state is read on demand). */
  async function wordViews(
    unitWords: UnitWord[],
    infos: Map<string, WordInfo>,
  ): Promise<UnitWordView[]> {
    return unitWords.map((w) => {
      const info = infos.get(keyOf(w));
      const inAnki = !!info && (info.noteIds.length > 0 || info.decks.length > 0);
      return {
        ...w,
        key: keyOf(w),
        state: info ? info.state : "absent",
        inAnki,
        decks: info?.decks ?? [],
      };
    });
  }

  async function statusFor(courseId: string, unit: Unit, infos: Map<string, WordInfo>) {
    const [unitWords, exercises, answers] = await Promise.all([
      repo.unitWords(courseId, unit.n),
      repo.unitExercises(courseId, unit.n),
      repo.bookAnswers(courseId, unit.n),
    ]);
    const views = await wordViews(unitWords, infos);
    const answered = new Map<number, number>();
    for (const a of answers)
      if (a.correct) answered.set(a.number, (answered.get(a.number) ?? 0) + 1);
    return unitStatus(
      views.map((v) => ({ state: v.state, inAnki: v.inAnki })),
      exercises.map((e) => ({ number: e.number, items: e.items.length })),
      answered,
    );
  }

  async function courseView(courseId: string): Promise<CourseView | null> {
    const course = (await repo.courses()).find((c) => c.id === courseId);
    if (!course) return null;
    const infos = await wordMap();
    const units: UnitRow[] = [];
    for (const unit of course.units) {
      units.push({ unit, status: await statusFor(courseId, unit, infos) });
    }
    const { units: _units, ...plain } = course;
    void _units;
    const snapshot = await repo.lastSnapshot(course.lang);
    return { course: plain, units, ankiReady: snapshot !== null };
  }

  async function courseList(): Promise<CourseListItem[]> {
    const out: CourseListItem[] = [];
    for (const c of await repo.courses()) {
      const view = await courseView(c.id);
      if (!view) continue;
      const themed = view.units.filter((r) => r.unit.kind === "theme" && r.status.total > 0);
      const total = themed.reduce((s, r) => s + r.status.total, 0);
      const known = themed.reduce((s, r) => s + r.status.known, 0);
      const open = view.units.find(
        (r) =>
          r.unit.kind === "theme" &&
          (r.status.exercisesDone < r.status.exercisesTotal ||
            (r.status.total > 0 && r.status.knownRatio < 1)),
      );
      out.push({
        course: view.course,
        unitCount: view.units.length,
        knownRatio: total > 0 ? known / total : null,
        continueUnit: open?.unit.n ?? null,
        ...(open
          ? {
              continueTitle: open.unit.title,
              continueKnown: open.status.total > 0 ? open.status.knownRatio : null,
            }
          : {}),
      });
    }
    return out;
  }

  async function unitView(courseId: string, n: number): Promise<UnitView | null> {
    const view = await courseView(courseId);
    const row = view?.units.find((r) => r.unit.n === n);
    if (!view || !row) return null;
    const infos = await wordMap();
    const [blocks, exercises, answers, unitWords, library, generated] = await Promise.all([
      repo.courseBlocks(courseId),
      repo.unitExercises(courseId, n),
      repo.bookAnswers(courseId, n),
      repo.unitWords(courseId, n),
      repo.listTexts(),
      repo.generatedUnitExercises(courseId, n),
    ]);
    const withAnswers = (e: BookExercise) => ({
      ...e,
      answers: e.items.map((_, i) => {
        const a = answers.find((x) => x.number === e.number && x.item === i);
        return a ? { answer: a.answer, correct: a.correct } : {};
      }),
    });
    const texts: UnitText[] = readingTexts(blocks, row.unit).map((t) => {
      const textId = library.find((x) => x.title === t.title)?.id;
      return {
        label: t.title.split(" · ").slice(1).join(" · ") || t.title,
        kind: t.kind,
        page: t.page,
        words: t.text.match(/\p{L}+/gu)?.length ?? 0,
        ...(textId ? { textId } : {}),
      };
    });
    return {
      course: view.course,
      unit: row.unit,
      status: row.status,
      texts,
      exercises: exercises.map(withAnswers),
      generated: generated.map(withAnswers),
      words: await wordViews(unitWords, infos),
      grammar: blocks
        .filter(
          (b) =>
            b.kind === "grammar" &&
            b.label &&
            (row.unit.kind === "grammar"
              ? b.page >= row.unit.pages[0] && b.page <= row.unit.pages[1]
              : grammarMatches(b, exercises)),
        )
        .map((b) => ({
          title: b.label ?? "",
          text: b.text,
          ...(b.topic && grammarTopic(b.topic, view.course.lang) ? { topicId: b.topic } : {}),
        })),
    };
  }

  /** A grammar chapter belongs to a unit when its heading's key word occurs in the unit's exercises. */
  function grammarMatches(block: Block, exercises: BookExercise[]): boolean {
    const keyWord = (block.label ?? "")
      .toLowerCase()
      .replace(/^\d+\s*/, "")
      .split(/\s+/)
      .find((w) => w.length >= 6);
    if (!keyWord) return false;
    return exercises.some((e) =>
      `${e.instruction} ${e.raw}`.toLowerCase().includes(keyWord.slice(0, 6)),
    );
  }

  return {
    courseList,
    course: courseView,
    unit: unitView,
    async unitStatus(courseId: string, n: number) {
      const course = await courseOrThrow(courseId);
      const unit = course.units.find((u) => u.n === n);
      if (!unit) throw new Error("Unknown unit.");
      return statusFor(courseId, unit, await wordMap());
    },
    async unitBlocks(courseId: string, n: number) {
      const course = await courseOrThrow(courseId);
      const unit = course.units.find((u) => u.n === n);
      if (!unit) return [];
      return (await repo.courseBlocks(courseId)).filter(
        (b) => b.page >= unit.pages[0] && b.page <= unit.pages[1],
      );
    },
  } satisfies Partial<CourseServices>;
}
