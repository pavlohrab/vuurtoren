/** Course packs: export a course's structure (or everything) and import a pack. */
import { pct } from "../../format.js";
import {
  type BookExercise,
  type Course,
  type CoursePack,
  type PackMode,
  type UnitWord,
  MIN_FINGERPRINT_MATCH,
  buildCoursePack,
  compareFingerprints,
  packExercises,
  packFileName,
  packUnits,
  pagesFingerprint,
  readingTexts,
} from "@app/core";
import type {
  CourseServices,
  ExportedPack,
  ImportProgress,
  PackImportResult,
} from "../courseTypes.js";
import type { CourseContext } from "./context.js";
import type { CourseImport } from "./import.js";

export function createCoursePacks(ctx: CourseContext, importer: CourseImport) {
  const { deps, repo, clock, courseOrThrow } = ctx;
  const { ocrPages, buildCourse, writePending, analyzeCourse, importUnitTexts } = importer;

  async function exportCoursePack(courseId: string, mode: PackMode): Promise<ExportedPack> {
    const course = await courseOrThrow(courseId);
    const { units, ...plain } = course;
    const exercises = new Map<number, BookExercise[]>();
    const words = new Map<number, UnitWord[]>();
    for (const u of units) {
      exercises.set(u.n, await repo.unitExercises(courseId, u.n));
      words.set(u.n, await repo.unitWords(courseId, u.n));
    }
    const pack = buildCoursePack(
      { course: plain, units, blocks: await repo.courseBlocks(courseId), exercises, words },
      mode,
      { now: clock(), meta: { generator: "Kenning" } },
    );
    return { fileName: packFileName(course.title, mode), json: JSON.stringify(pack, null, 1) };
  }

  async function importCoursePack(
    pack: CoursePack,
    opts: { files?: File[]; onProgress?: (p: ImportProgress) => void } = {},
  ): Promise<PackImportResult> {
    const { onProgress } = opts;
    const counts = {
      units: pack.units.length,
      words: pack.units.reduce((n, u) => n + u.words.length, 0),
      exercises: pack.units.reduce((n, u) => n + u.exercises.length, 0),
    };
    if (pack.mode === "structure") {
      const files = opts.files ?? [];
      const first = files[0];
      if (!first) throw new Error("Choose your copy of the book: a structure pack has no text.");
      const kind = /\.(png|jpe?g|webp|tiff?)$/i.test(first.name) ? "images" : "pdf";
      const pages = await ocrPages(files, { title: pack.course.title, kind }, onProgress);
      const fp = compareFingerprints(pack, pages.length, pagesFingerprint(pages));
      if (!fp.samePageCount)
        throw new Error(
          `This pack is for a book of ${pack.course.pageCount} pages; your file has ${pages.length}.`,
        );
      if (fp.ratio < MIN_FINGERPRINT_MATCH)
        throw new Error(
          `Your file does not look like the book of this pack: only ${pct(fp.ratio)} of its pages match.`,
        );
      const courseId = await buildCourse(
        pages,
        pack.course.title,
        { kind, filename: first.name },
        onProgress,
        (id) => packUnits(pack, id),
      );
      writePending(null);
      const r = await analyzeCourse(courseId, onProgress, pack);
      return { courseId, ...counts, ...r, fingerprint: fp.ratio };
    }
    const blocks = pack.blocks ?? [];
    onProgress?.({ stage: "outline", done: 0, total: 1, message: "Creating the course" });
    const courseId = crypto.randomUUID();
    const course: Course = {
      id: courseId,
      title: pack.course.title,
      lang: pack.course.lang,
      source: { ...pack.course.source },
      pageCount: pack.course.pageCount,
      created: clock(),
      ...(pack.course.level ? { level: pack.course.level } : {}),
    };
    const units = packUnits(pack, courseId);
    await repo.append({ type: "CourseImported", course });
    await repo.append({ type: "UnitDefined", courseId, units });
    await repo.append({ type: "BlocksExtracted", courseId, blocks });
    for (const u of pack.units) {
      await repo.append({
        type: "BookExerciseExtracted",
        courseId,
        unitN: u.n,
        exercises: packExercises(u),
      });
      if (u.words.length > 0)
        await repo.append({ type: "UnitWordsSet", courseId, unitN: u.n, words: u.words });
    }
    onProgress?.({ stage: "outline", done: 1, total: 1, message: "Course created" });
    const withTexts = units.filter((u) => u.kind === "theme" || u.kind === "other");
    let texts: { texts: number; textsFailed: number };
    try {
      texts = await importUnitTexts(courseId, withTexts, blocks, onProgress, 0, withTexts.length);
    } catch {
      // The course is there; its texts can be added later (Edit outline → analyse again).
      texts = {
        texts: 0,
        textsFailed: withTexts.reduce((n, u) => n + readingTexts(blocks, u).length, 0),
      };
    }
    onProgress?.({ stage: "done", done: 1, total: 1, message: "Course ready" });
    deps.changed();
    return { courseId, ...counts, ...texts };
  }

  return { exportCoursePack, importCoursePack } satisfies Partial<CourseServices>;
}
