/** Course import: OCR job (resumable), outline, analysis of exercises, words and texts. */
import { deviceStorage } from "../../storage/local.js";
import {
  type Block,
  type BookExercise,
  type Course,
  type CoursePack,
  type OcrPage,
  type Unit,
  applyStructure,
  assignKinds,
  detectOutline,
  readingTexts,
  recognizeExercises,
  segmentPages,
  stripRunningText,
  unitWordLists,
  validateOutline,
} from "@app/core";
import { type NlpClient, isOcrLang } from "@app/nlp-client";
import { type DeriveClient, deriveAnswers } from "../courseDerive.js";
import type {
  CourseServices,
  CourseSourceInput,
  ImportProgress,
  OutlineRow,
  PagePreview,
  PendingImport,
} from "../courseTypes.js";
import type { CourseContext } from "./context.js";

const PENDING_KEY = "kenning.course.pendingImport";

/** "about 3 min left" from seconds. */
function etaText(eta: number | null | undefined): string {
  if (eta === null || eta === undefined) return "";
  if (eta < 60) return " · less than a minute left";
  return ` · about ${Math.round(eta / 60)} min left`;
}

/** Marker in a Library text's source reference: `course:<courseId>:<unit>`. */
const courseRef = (courseId: string, unitN: number) => `course:${courseId}:${unitN}`;

const POLL_MS = 1500;

const fileTitle = (name: string) =>
  name
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .replace(/[_-]+/g, " ")
    .trim();

export function createCourseImport(ctx: CourseContext) {
  const { deps, repo, clock, courseOrThrow } = ctx;

  const storage = deps.storage ?? deviceStorage();
  const readPending = (): PendingImport | null => {
    try {
      const raw = storage.getItem(PENDING_KEY);
      return raw ? (JSON.parse(raw) as PendingImport) : null;
    } catch {
      // Unreadable entry: nothing to resume (expected).
      return null;
    }
  };
  const writePending = (p: PendingImport | null) => {
    try {
      if (p) storage.setItem(PENDING_KEY, JSON.stringify(p));
      else storage.removeItem(PENDING_KEY);
    } catch {
      // Without storage an import cannot be resumed; it still works in one go.
    }
  };

  /** Poll an OCR job to the end; resolves with all pages. */
  async function pollPages(
    client: NlpClient,
    jobId: string,
    total: number,
    onProgress?: (p: ImportProgress) => void,
  ): Promise<OcrPage[]> {
    const pages: OcrPage[] = [];
    for (;;) {
      const st = await client.courseOcrStatus(jobId, pages.length);
      pages.push(...st.pages);
      const all = st.total || total;
      onProgress?.({
        stage: "ocr",
        done: st.done,
        total: all,
        message:
          st.done >= all
            ? `Read all ${all} pages`
            : `Reading page ${Math.min(st.done + 1, all)} of ${all}${etaText(st.eta)}`,
      });
      if (st.status === "error") throw new Error(st.error ?? "OCR failed.");
      if (st.status === "done" && pages.length >= st.total) return pages;
      await new Promise((r) => setTimeout(r, deps.pollMs ?? POLL_MS));
    }
  }

  /** Start the server OCR job (remembered, so the wizard can be left); resolves with all pages. */
  async function ocrPages(
    files: readonly File[],
    meta: { title: string; kind: "pdf" | "images" },
    onProgress?: (p: ImportProgress) => void,
  ): Promise<OcrPage[]> {
    const client = await deps.nlp();
    const lang = (await deps.settings()).lang;
    const job = await client.courseOcrStart(files, isOcrLang(lang) ? lang : "nl");
    writePending({
      jobId: job.id,
      title: meta.title,
      filename: files[0]?.name ?? "",
      kind: meta.kind,
      lang,
      total: job.total,
      startedAt: clock(),
    });
    return pollPages(client, job.id, job.total, onProgress);
  }

  /** Turn recognised pages into a saved course with its draft outline. */
  async function buildCourse(
    pages: OcrPage[],
    title: string,
    source: Course["source"],
    onProgress?: (p: ImportProgress) => void,
    units?: (courseId: string) => Unit[],
  ): Promise<string> {
    if (pages.every((p) => !p.text.trim())) throw new Error("No text was found in this file.");
    onProgress?.({ stage: "outline", done: 0, total: 1, message: "Finding units and exercises" });
    const courseId = crypto.randomUUID();
    const outline = units ? units(courseId) : detectOutline(pages, courseId);
    const blocks = assignKinds(
      segmentPages(
        stripRunningText(pages),
        outline.map((u) => u.pages[0]),
      ),
      outline,
    );
    const course: Course = {
      id: courseId,
      title: title || "Course",
      lang: (await deps.settings()).lang,
      source,
      pageCount: pages.length,
      created: clock(),
    };
    await repo.append({ type: "CourseImported", course });
    await repo.append({ type: "UnitDefined", courseId, units: outline });
    await repo.append({ type: "BlocksExtracted", courseId, blocks });
    onProgress?.({ stage: "outline", done: 1, total: 1, message: "Outline ready" });
    return courseId;
  }

  async function resumeImport(onProgress?: (p: ImportProgress) => void): Promise<string> {
    const p = readPending();
    if (!p) throw new Error("There is no unfinished import.");
    const client = await deps.nlp();
    let pages: OcrPage[];
    try {
      pages = await pollPages(client, p.jobId, p.total, onProgress);
    } catch (e) {
      if (/unknown or expired|404/i.test(String((e as Error).message ?? e))) {
        writePending(null);
        throw new Error(
          "The language server no longer has this reading job (it was restarted, or the job finished more than an hour ago). Choose the file again: pages it already read come from its cache.",
          { cause: e },
        );
      }
      throw e;
    }
    const id = await buildCourse(
      pages,
      p.title,
      { kind: p.kind, filename: p.filename },
      onProgress,
    );
    writePending(null);
    return id;
  }

  async function importCourse(
    input: CourseSourceInput,
    onProgress?: (p: ImportProgress) => void,
  ): Promise<string> {
    if (input.kind === "text") {
      const pages = input.text.split("\f").map((text, i) => ({ n: i + 1, text }));
      return buildCourse(pages, input.title, { kind: "text" }, onProgress);
    }
    if (input.kind === "url") {
      // One page and one unit per web page, titled by the page.
      const client = await deps.nlp();
      const pages: OcrPage[] = [];
      const titles: string[] = [];
      for (const [i, url] of input.urls.entries()) {
        onProgress?.({
          stage: "ocr",
          done: i,
          total: input.urls.length,
          message: `Reading page ${i + 1} of ${input.urls.length}`,
        });
        const r = await client.extractUrl(url);
        pages.push({ n: i + 1, text: `${r.title}\n\n${r.text}` });
        titles.push(r.title.trim() || `Page ${i + 1}`);
      }
      return buildCourse(pages, input.title, { kind: "url" }, onProgress, (courseId) =>
        titles.map((title, i) => ({
          courseId,
          n: i + 1,
          title,
          pages: [i + 1, i + 1] as [number, number],
          ankiDecks: [],
          kind: "theme" as const,
        })),
      );
    }
    const first = input.files[0];
    if (!first) throw new Error("Choose a file first.");
    const title = input.title?.trim() || fileTitle(first.name);
    const pages = await ocrPages(input.files, { title, kind: input.kind }, onProgress);
    const id = await buildCourse(
      pages,
      title,
      { kind: input.kind, filename: first.name },
      onProgress,
    );
    writePending(null);
    return id;
  }

  async function editOutline(courseId: string, rows: OutlineRow[]): Promise<void> {
    const course = await courseOrThrow(courseId);
    const problem = validateOutline(rows, course.pageCount);
    if (problem) throw new Error(problem);
    const units: Unit[] = rows.map((r, i) => ({
      courseId,
      n: i + 1,
      title: r.title.trim() || `Unit ${i + 1}`,
      pages: r.pages,
      kind: r.kind,
      // Keep the deck mapping of a unit that stays in place.
      ankiDecks: course.units.find((u) => u.title === r.title)?.ankiDecks ?? [],
    }));
    await repo.append({ type: "UnitDefined", courseId, units });
    const blocks = assignKinds(await repo.courseBlocks(courseId), units);
    await repo.append({ type: "BlocksExtracted", courseId, blocks });
  }

  // ------------------------------------------------------------------ analysis

  async function analyzeCourse(
    courseId: string,
    onProgress?: (p: ImportProgress) => void,
    overlay?: CoursePack,
  ): Promise<{ matched: number; missing: number; texts: number; textsFailed: number }> {
    const course = await courseOrThrow(courseId);
    const blocks = await repo.courseBlocks(courseId);
    const client = await deps.nlp();
    const derive: DeriveClient = {
      // Forms are optional (fewer matches); an outage shows in the degraded indicator.
      forms: (lang, lemmas) => client.forms(lang, lemmas).catch(() => ({})),
      analyzeText: (lang, texts) => client.analyzeText(lang, texts),
    };
    const themes = course.units.filter((u) => u.kind === "theme" || u.kind === "other");
    const wordLists = unitWordLists(blocks, course.units);

    let step = 0;
    let matched = 0;
    let missing = 0;
    const total = themes.length * 2 + 1;
    for (const unit of themes) {
      onProgress?.({
        stage: "exercises",
        done: step++,
        total,
        message: `Exercises of ${unit.title}`,
      });
      const inUnit = blocks.filter((b) => b.page >= unit.pages[0] && b.page <= unit.pages[1]);
      const previous = await repo.unitExercises(courseId, unit.n);
      let exercises = recognizeExercises(inUnit);
      exercises = await deriveAnswers(exercises, derive);
      const packUnit = overlay?.units.find((u) => u.n === unit.n);
      if (packUnit) {
        const applied = applyStructure(exercises, packUnit.exercises);
        exercises = applied.exercises;
        matched += applied.matched;
        missing += applied.missing;
      }
      exercises = exercises.map((e) =>
        keepUserEdits(
          e,
          previous.find((p) => p.number === e.number),
        ),
      );
      await repo.append({ type: "BookExerciseExtracted", courseId, unitN: unit.n, exercises });
      const words = packUnit?.words.length ? packUnit.words : wordLists.get(unit.n);
      if (words && words.length > 0) {
        await repo.append({ type: "UnitWordsSet", courseId, unitN: unit.n, words });
      }
    }
    const texts = await importUnitTexts(courseId, themes, blocks, onProgress, step, total);
    onProgress?.({ stage: "done", done: total, total, message: "Course ready" });
    deps.changed();
    return { matched, missing, ...texts };
  }

  /** Add the reading texts and transcripts of units to the Library (skipping ones already there). */
  async function importUnitTexts(
    courseId: string,
    units: readonly Unit[],
    blocks: readonly Block[],
    onProgress: ((p: ImportProgress) => void) | undefined,
    step: number,
    total: number,
  ): Promise<{ texts: number; textsFailed: number }> {
    const library = await repo.listTexts();
    let texts = 0;
    let textsFailed = 0;
    let firstError: unknown = null;
    for (const unit of units) {
      onProgress?.({ stage: "texts", done: step++, total, message: `Texts of ${unit.title}` });
      for (const t of readingTexts(blocks, unit)) {
        if (library.some((x) => x.title === t.title)) {
          texts++;
          continue;
        }
        try {
          await deps.importText({
            kind: "paste",
            title: t.title,
            content: t.text,
            ref: courseRef(courseId, unit.n),
          });
          texts++;
        } catch (e) {
          textsFailed++;
          firstError ??= e;
          // Without the language server no text can be analysed: stop trying.
          if (texts === 0 && textsFailed >= 2) throw e;
        }
      }
    }
    if (texts === 0 && firstError) throw firstError;
    return { texts, textsFailed };
  }

  /** Corrections the user made survive a re-analysis (same prompt, answer set by the user). */
  function keepUserEdits(fresh: BookExercise, old: BookExercise | undefined): BookExercise {
    if (!old) return fresh;
    const items = fresh.items.map((it) => {
      const prior = old.items.find((p) => p.prompt === it.prompt && p.answerSource === "user");
      return prior ?? it;
    });
    return { ...fresh, items };
  }

  // ------------------------------------------------------------------ outline editor

  async function pagePreviews(courseId: string): Promise<PagePreview[]> {
    const course = await courseOrThrow(courseId);
    const blocks = await repo.courseBlocks(courseId);
    const byPage = new Map<number, string[]>();
    for (const b of blocks) {
      const lines = byPage.get(b.page) ?? [];
      if (lines.length >= 3) continue;
      const own = [b.label, ...b.text.split("\n")]
        .map((l) => l?.trim() ?? "")
        .filter((l) => /\p{L}{3}/u.test(l));
      byPage.set(b.page, [...lines, ...own].slice(0, 3));
    }
    return Array.from({ length: course.pageCount }, (_, i) => ({
      n: i + 1,
      lines: byPage.get(i + 1) ?? [],
    }));
  }

  return {
    readPending,
    writePending,
    ocrPages,
    buildCourse,
    analyzeCourse,
    importUnitTexts,
    services: {
      importCourse,
      async pendingImport() {
        return readPending();
      },
      resumeImport,
      async discardPendingImport() {
        const p = readPending();
        writePending(null);
        if (p) {
          try {
            await (await deps.nlp()).courseOcrCancel(p.jobId);
          } catch {
            // Already finished or gone.
          }
        }
      },
      async analyzeCourse(courseId: string, onProgress?: (p: ImportProgress) => void) {
        await analyzeCourse(courseId, onProgress);
      },
      async outline(courseId: string): Promise<OutlineRow[]> {
        return (await courseOrThrow(courseId)).units.map((u) => ({
          title: u.title,
          pages: u.pages,
          kind: u.kind,
        }));
      },
      editOutline,
      pagePreviews,
    } satisfies Partial<CourseServices>,
  };
}

export type CourseImport = ReturnType<typeof createCourseImport>;
