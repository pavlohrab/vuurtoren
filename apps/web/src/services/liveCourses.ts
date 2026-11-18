/**
 * Course services on top of the local database, the NLP server (OCR job, forms, analysis) and
 * Anki. Book content only ever lives in the user's own event log; nothing is sent anywhere but
 * the user's own NLP server. Anki writes are the explicit actions of ADR 0007 (Learn next, add
 * notes), each logged as an event.
 */
import { AnkiConnectClient, addWordToAnki, studyWordsFirst } from "@app/anki";
import {
  type Block,
  type BookExercise,
  type Course,
  type CoursePack,
  type Exercise,
  type ExerciseKind,
  type ItemCheck,
  type LanguageProfile,
  type LearnerModel,
  type OcrPage,
  type PackMode,
  type Unit,
  type UnitWord,
  type WordData,
  MIN_FINGERPRINT_MATCH,
  applyStructure,
  assignKinds,
  bookItemKeys,
  buildCoursePack,
  compareFingerprints,
  checkBookItem,
  detectOutline,
  isVerbSecond,
  migratedProfile,
  normalizeKey,
  packExercises,
  packFileName,
  packUnits,
  pagesFingerprint,
  readingTexts,
  recognizeExercises,
  resolveDeck,
  segmentPages,
  stripRunningText,
  suggestDecks,
  unitStatus,
  unitWordLists,
  validateOutline,
} from "@app/core";
import { grammarTopic, topicForHit } from "@app/content";
import type { KenningRepository, WordInfo } from "@app/db";
import { type NlpClient, isOcrLang } from "@app/nlp-client";
import { createRng, generate, shuffle } from "../practice/engine.js";
import { type DeriveClient, deriveAnswers } from "./courseDerive.js";
import type {
  AddMissingResult,
  AddWordRow,
  AddWordsPreview,
  BookCheckResult,
  CourseListItem,
  CourseServices,
  CourseSourceInput,
  CourseView,
  DeckMapping,
  ExportedPack,
  ImportProgress,
  LearnNextResult,
  OutlineRow,
  PackImportResult,
  PagePreview,
  PendingImport,
  UnitGrammarTopic,
  UnitRow,
  UnitText,
  UnitView,
  UnitWordView,
} from "./courseTypes.js";
import type { ImportInput, Settings } from "./types.js";

export interface LiveCoursesDeps {
  repo: KenningRepository;
  settings: () => Promise<Settings>;
  /** The language profile (deck routing); defaults to the old target deck for everything. */
  profile?: () => Promise<LanguageProfile>;
  nlp: () => Promise<NlpClient>;
  anki: () => Promise<AnkiConnectClient>;
  /** Adds a text to the Library (analysing it); returns its id. */
  importText: (input: ImportInput) => Promise<string>;
  model: () => Promise<LearnerModel>;
  /** The engine's WordData for some words (shared with practice: `buildWordData`). */
  wordData: (
    lang: string,
    entries: readonly { key: string; info: WordInfo | null }[],
  ) => Promise<WordData[]>;
  /** Called after changes that make cached learner data stale. */
  changed: () => void;
  now?: () => number;
  /** Polling interval of the OCR job in ms (shortened in tests). */
  pollMs?: number;
  /** Where the pending import is remembered (default: localStorage, or memory). */
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  /** Deck names for the Add to Anki picker (the profile's deck choices). */
  deckOptions?: () => Promise<string[]>;
}

const PENDING_KEY = "kenning.course.pendingImport";

function defaultStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  try {
    localStorage.setItem("kenning.probe", "1");
    localStorage.removeItem("kenning.probe");
    return localStorage;
  } catch {
    // Expected in private windows / blocked storage: in-memory for this session.
    const m = new Map<string, string>();
    return {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => void m.set(k, v),
      removeItem: (k) => void m.delete(k),
    };
  }
}

/** "about 3 min left" from seconds. */
function etaText(eta: number | null | undefined): string {
  if (eta === null || eta === undefined) return "";
  if (eta < 60) return " · less than a minute left";
  return ` · about ${Math.round(eta / 60)} min left`;
}

/** Marker in a Library text's source reference: `course:<courseId>:<unit>`. */
const courseRef = (courseId: string, unitN: number) => `course:${courseId}:${unitN}`;

const POLL_MS = 1500;
const MAX_PRACTICE_WORDS = 60;

/** Kinds of the practice engine that imitate each book exercise type ("more like this"). */
const KINDS_FOR_TYPE: Partial<Record<BookExercise["type"], ExerciseKind[]>> = {
  gapfill: ["verb-form", "perfect", "cloze-typed"],
  "conjugation-table": ["verb-form"],
  "sentence-building": ["scramble"],
  choice: ["cloze-choice", "word-choice"],
};

/** A card-sized gloss: the first two senses without their explanations in brackets. */
function shortGloss(senses: readonly string[]): string {
  const clean = senses
    .map((g) =>
      g
        .replace(/\s*\([^)]*\)/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
  const out: string[] = [];
  for (const g of clean) {
    if (out.length >= 2 || [...out, g].join("; ").length > 60) break;
    if (!out.includes(g)) out.push(g);
  }
  return out.join("; ") || (clean[0] ?? "").slice(0, 60);
}

const fileTitle = (name: string) =>
  name
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .replace(/[_-]+/g, " ")
    .trim();

/** Create the course part of AppServices. */
export function createLiveCourses(deps: LiveCoursesDeps): CourseServices {
  const { repo } = deps;
  const clock = deps.now ?? Date.now;

  async function courseOrThrow(courseId: string) {
    const c = (await repo.courses()).find((x) => x.id === courseId);
    if (!c) throw new Error("This course no longer exists.");
    return c;
  }

  // ------------------------------------------------------------------ import

  const storage = deps.storage ?? defaultStorage();
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

  // ------------------------------------------------------------------ views

  const keyOf = (w: UnitWord) => normalizeKey(w.lemma);

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

  async function wordMap(): Promise<Map<string, WordInfo>> {
    const lang = (await deps.settings()).lang;
    return new Map((await repo.words(lang)).map((w) => [w.key, w]));
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

  // ------------------------------------------------------------------ Anki

  async function deckMapping(courseId: string): Promise<DeckMapping> {
    const course = await courseOrThrow(courseId);
    let decks: string[] = [];
    try {
      decks = (await (await deps.anki()).deckNames()).sort();
    } catch {
      // Anki not reachable: the user can still continue without a mapping.
    }
    const themes = course.units.filter((u) => u.kind === "theme");
    const sug = suggestDecks(themes, decks);
    return {
      decks,
      suggested: Object.fromEntries(sug.map((s) => [s.n, s.decks])),
      current: Object.fromEntries(course.units.map((u) => [u.n, u.ankiDecks])),
    };
  }

  async function mapDecks(courseId: string, mapping: Record<number, string[]>): Promise<void> {
    const course = await courseOrThrow(courseId);
    const lang = (await deps.settings()).lang;
    const all = await repo.words(lang);
    for (const unit of course.units) {
      const decks = mapping[unit.n];
      if (!decks) continue;
      await repo.append({ type: "UnitEdited", courseId, n: unit.n, patch: { ankiDecks: decks } });
      // Without a word list, the unit's words are the notes of its decks.
      if (decks.length > 0 && (await repo.unitWords(courseId, unit.n)).length === 0) {
        const words: UnitWord[] = all
          .filter((w) => w.decks.some((d) => decks.includes(d)))
          .map((w) => ({
            lemma: w.key,
            source: "anki" as const,
            ...(w.article ? { article: w.article } : {}),
            ...(w.gloss ? { gloss: w.gloss } : {}),
          }));
        if (words.length > 0)
          await repo.append({ type: "UnitWordsSet", courseId, unitN: unit.n, words });
      }
    }
    deps.changed();
  }

  async function learnNextForUnit(courseId: string, n: number): Promise<LearnNextResult> {
    const lang = (await deps.settings()).lang;
    const infos = await wordMap();
    const keys = [...new Set((await repo.unitWords(courseId, n)).map(keyOf))];
    const total = keys.length;
    const withNotes = keys
      .flatMap((k) => infos.get(k) ?? [])
      .filter((w) => w.noteIds.length > 0 && w.state !== "known");
    if (withNotes.length === 0) return { moved: 0, skipped: total };
    // In the unit's word order, so Anki introduces the words as the book does.
    const { moved } = await studyWordsFirst(
      await deps.anki(),
      (e) => repo.append(e),
      lang,
      withNotes,
    );
    deps.changed();
    return { moved, skipped: total - moved };
  }

  async function addMissingUnitWords(
    courseId: string,
    n: number,
    opts?: { deck?: string },
  ): Promise<AddMissingResult> {
    return addUnitWords(courseId, n, opts?.deck ? { deck: opts.deck } : {});
  }

  // ------------------------------------------------------------------ practice

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

  // ------------------------------------------------------------------ book exercises

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

  // ------------------------------------------------------------------ words to Anki

  /**
   * Finder of a sentence of the unit's pages that uses a word: the lemma itself, or a form
   * sharing its stem ("fietst" for "fietsen"). Indexes the words of the sentences once.
   */
  function exampleFinder(sentences: readonly string[]): (lemma: string) => string | undefined {
    const first = new Map<string, number>();
    sentences.forEach((x, i) => {
      for (const w of x.toLowerCase().match(/\p{L}+/gu) ?? []) if (!first.has(w)) first.set(w, i);
    });
    const words = [...first.keys()];
    return (lemma) => {
      const l = lemma.toLowerCase();
      if (l.length < 2) return undefined;
      if (/\s/.test(l)) return sentences.find((x) => x.toLowerCase().includes(l));
      const exact = first.get(l);
      if (exact !== undefined) return sentences[exact];
      const stem = l.length >= 5 ? l.replace(/(en|e|n)$/u, "") : l;
      let best: number | undefined;
      for (const w of words) {
        if (w.length > stem.length + 3 || !w.startsWith(stem)) continue;
        const i = first.get(w) ?? Infinity;
        if (best === undefined || i < best) best = i;
      }
      return best === undefined ? undefined : sentences[best];
    };
  }

  /** Sentences of a unit's pages (reading texts and exercise items), 4 to 25 words. */
  function unitSentences(blocks: readonly Block[], unit: Unit): string[] {
    const text = blocks
      .filter((b) => b.page >= unit.pages[0] && b.page <= unit.pages[1])
      .map((b) => b.text.replace(/-\n(?=\p{Ll})/gu, "").replace(/\n/g, " "))
      .join(" ");
    return (text.match(/[^.!?]*\p{L}[^.!?]*[.!?]/gu) ?? [])
      .map((x) =>
        x
          .replace(/\s+/g, " ")
          .replace(/^[\d\W]+/u, "")
          .trim(),
      )
      .filter((x) => {
        const n = x.match(/\p{L}+/gu)?.length ?? 0;
        return n >= 4 && n <= 25 && !x.includes("____") && /^\p{Lu}/u.test(x);
      });
  }

  async function currentProfile(): Promise<LanguageProfile> {
    const s = await deps.settings();
    return deps.profile ? deps.profile() : migratedProfile(s.lang, s.targetDeck, []);
  }

  /** Where a unit's new words go: the per-unit rule prefers the Anki deck the unit is mapped to. */
  function unitDeck(profile: LanguageProfile, courseTitle: string, unit: Unit): string {
    if (profile.courseDecks === "unit" && unit.ankiDecks[0]) return unit.ankiDecks[0];
    return resolveDeck(profile, {
      source: "course",
      course: { title: courseTitle, unitTitle: unit.title },
    });
  }

  async function addWordsPreview(
    courseId: string,
    scope: number | "all",
  ): Promise<AddWordsPreview> {
    const course = await courseOrThrow(courseId);
    const units = course.units.filter((u) =>
      scope === "all" ? u.kind === "theme" || u.kind === "other" : u.n === scope,
    );
    const [infos, blocks, profile] = await Promise.all([
      wordMap(),
      repo.courseBlocks(courseId),
      currentProfile(),
    ]);
    const rows: AddWordRow[] = [];
    const seen = new Set<string>();
    for (const unit of units) {
      const exampleFor = exampleFinder(unitSentences(blocks, unit));
      for (const w of await repo.unitWords(courseId, unit.n)) {
        const key = keyOf(w);
        if (seen.has(key)) continue;
        seen.add(key);
        const info = infos.get(key);
        const example = w.example ?? exampleFor(w.lemma);
        rows.push({
          key,
          lemma: w.lemma,
          unitN: unit.n,
          status:
            info?.state === "known" ? "known" : info && info.noteIds.length > 0 ? "in-anki" : "new",
          ...(w.article ? { article: w.article } : {}),
          ...(w.gloss ? { gloss: w.gloss } : {}),
          ...(example ? { example } : {}),
        });
      }
    }
    // Glosses (and de/het) from the dictionary for words the book list does not gloss.
    const missing = rows.filter((r) => r.status === "new" && !r.gloss).map((r) => r.lemma);
    if (missing.length > 0 && course.lang === "nl") {
      try {
        const found = await (await deps.nlp()).gloss("nl", missing);
        for (const r of rows) {
          const g = found[r.lemma]?.[0];
          if (!g) continue;
          if (!r.gloss && g.glosses[0]) r.gloss = shortGloss(g.glosses);
          if (!r.article && g.article && g.article !== "de/het") r.article = g.article;
        }
      } catch {
        // The dictionary is optional: words go to Anki without a gloss.
      }
    }
    // Deck suggestions are optional (Anki may be closed): the default decks are still offered.
    const options: string[] = deps.deckOptions ? await deps.deckOptions().catch(() => []) : [];
    const decks = Object.fromEntries(units.map((u) => [u.n, unitDeck(profile, course.title, u)]));
    return {
      rows,
      decks,
      options: [...new Set([...Object.values(decks), ...options])],
    };
  }

  async function addUnitWords(
    courseId: string,
    scope: number | "all",
    opts: { keys?: string[]; deck?: string } = {},
  ): Promise<AddMissingResult> {
    const course = await courseOrThrow(courseId);
    const preview = await addWordsPreview(courseId, scope);
    const wanted = opts.keys ? new Set(opts.keys) : null;
    const rows = preview.rows.filter(
      (r) => r.status === "new" && (wanted ? wanted.has(r.key) : true),
    );
    const profile = await currentProfile();
    const anki = await deps.anki();
    const slug = course.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    let added = 0;
    let failed = 0;
    let lastDeck = opts.deck ?? Object.values(preview.decks)[0] ?? profile.destinations.default;
    for (const r of rows) {
      const unit = course.units.find((u) => u.n === r.unitN);
      const deck = opts.deck ?? preview.decks[r.unitN];
      try {
        const res = await addWordToAnki(anki, (e) => repo.append(e), {
          profile,
          context: {
            source: "course",
            course: { title: course.title, ...(unit ? { unitTitle: unit.title } : {}) },
            ...(deck ? { deck } : {}),
          },
          word: r.article ? `${r.article} ${r.lemma}` : r.lemma,
          key: r.key,
          source: course.title,
          extraTags: [`kenning::course::${slug}::${r.unitN}`],
          ...(r.gloss ? { gloss: r.gloss } : {}),
          ...(r.example ? { sentence: r.example } : {}),
        });
        lastDeck = res.deck;
        added++;
      } catch {
        // Counted and returned to the screen, which reports how many words failed.
        failed++;
      }
    }
    deps.changed();
    return { added, failed, deck: lastDeck };
  }

  // ------------------------------------------------------------------ grammar

  const grammarCache = new Map<string, UnitGrammarTopic[]>();
  const baselineCache = new Map<string, Promise<Map<string, number>>>();

  /** Sentences that show each grammar topic, per topic id, with a sample sentence. */
  async function topicCounts(
    lang: string,
    sentences: readonly string[],
  ): Promise<Map<string, { count: number; example: string }>> {
    const hits = await (await deps.nlp()).grammar("nl", [...sentences]);
    const counts = new Map<string, { count: number; example: string }>();
    hits.forEach((list, i) => {
      for (const id of new Set(list.map((h) => topicForHit(h.topic, lang)?.id ?? ""))) {
        if (!id) continue;
        const cur = counts.get(id) ?? { count: 0, example: sentences[i] ?? "" };
        cur.count++;
        counts.set(id, cur);
      }
    });
    return counts;
  }

  /** How often each topic occurs in a sample of the whole course (share of sentences). */
  function courseBaseline(course: { id: string; lang: string; units: Unit[] }, blocks: Block[]) {
    let p = baselineCache.get(course.id);
    if (!p) {
      p = (async () => {
        const themes = course.units.filter((u) => u.kind === "theme");
        const per = Math.max(10, Math.floor(400 / Math.max(1, themes.length)));
        const sample = themes.flatMap((u) => unitSentences(blocks, u).slice(0, per));
        const counts = await topicCounts(course.lang, sample);
        return new Map([...counts].map(([id, c]) => [id, c.count / Math.max(1, sample.length)]));
      })();
      baselineCache.set(course.id, p);
      p.catch(() => baselineCache.delete(course.id));
    }
    return p;
  }

  /**
   * Grammar topics of a unit, ranked by how much more the unit uses them than the course does
   * (so "plural nouns" and "questions", which every unit has, do not crowd out what the unit
   * teaches), with at least three sentences each.
   */
  async function unitGrammar(courseId: string, n: number): Promise<UnitGrammarTopic[]> {
    const cacheKey = `${courseId}:${n}`;
    const cached = grammarCache.get(cacheKey);
    if (cached) return cached;
    const course = await courseOrThrow(courseId);
    const unit = course.units.find((u) => u.n === n);
    if (!unit || course.lang !== "nl") return [];
    const blocks = await repo.courseBlocks(courseId);
    const sentences = [
      ...readingTexts(blocks, unit).flatMap((t) => t.text.split(/(?<=[.!?])\s+/u)),
      ...unitSentences(blocks, unit),
    ]
      .filter((x) => (x.match(/\p{L}+/gu)?.length ?? 0) >= 4)
      .slice(0, 400);
    if (sentences.length === 0) return [];
    let counts: Map<string, { count: number; example: string }>;
    let baseline: Map<string, number>;
    try {
      [counts, baseline] = await Promise.all([
        topicCounts(course.lang, sentences),
        unit.kind === "theme" ? courseBaseline(course, blocks) : Promise.resolve(new Map()),
      ]);
    } catch {
      // Grammar topics of a unit are optional; an outage shows in the degraded indicator.
      return [];
    }
    const lift = (id: string, c: number) => {
      const rate = c / sentences.length;
      const base = baseline.get(id);
      return base ? rate / base : 1;
    };
    const out: UnitGrammarTopic[] = [...counts]
      .filter(([, c]) => c.count >= 3)
      .sort(
        (a, b) =>
          lift(b[0], b[1].count) * Math.sqrt(b[1].count) -
          lift(a[0], a[1].count) * Math.sqrt(a[1].count),
      )
      .flatMap(([id, c]) => {
        const t = topicForHit(id, course.lang);
        return t
          ? [
              {
                topicId: t.id,
                title: t.title,
                level: t.level,
                summary: t.summary,
                count: c.count,
                ...(c.example ? { example: c.example } : {}),
              },
            ]
          : [];
      })
      .slice(0, 6);
    grammarCache.set(cacheKey, out);
    return out;
  }

  // ------------------------------------------------------------------ course packs

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
          `Your file does not look like the book of this pack: only ${Math.round(fp.ratio * 100)}% of its pages match.`,
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

  return {
    exportCoursePack,
    importCoursePack,
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
    pagePreviews,
    addWordsPreview,
    addUnitWords,
    unitGrammar,
    async analyzeCourse(courseId, onProgress) {
      await analyzeCourse(courseId, onProgress);
    },
    courseList,
    course: courseView,
    async deleteCourse(courseId) {
      await repo.append({ type: "CourseDeleted", courseId });
      deps.changed();
    },
    async outline(courseId): Promise<OutlineRow[]> {
      return (await courseOrThrow(courseId)).units.map((u) => ({
        title: u.title,
        pages: u.pages,
        kind: u.kind,
      }));
    },
    editOutline,
    deckMapping,
    mapDecks,
    unit: unitView,
    async unitStatus(courseId, n) {
      const course = await courseOrThrow(courseId);
      const unit = course.units.find((u) => u.n === n);
      if (!unit) throw new Error("Unknown unit.");
      return statusFor(courseId, unit, await wordMap());
    },
    learnNextForUnit,
    addMissingUnitWords,
    unitPractice,
    moreLikeThis,
    checkBookItem: checkItem,
    setBookAnswer,
    async editBookExercise(courseId, n, number, patch) {
      await repo.append({ type: "BookExerciseEdited", courseId, unitN: n, number, patch });
    },
    async unitBlocks(courseId, n) {
      const course = await courseOrThrow(courseId);
      const unit = course.units.find((u) => u.n === n);
      if (!unit) return [];
      return (await repo.courseBlocks(courseId)).filter(
        (b) => b.page >= unit.pages[0] && b.page <= unit.pages[1],
      );
    },
  };
}
