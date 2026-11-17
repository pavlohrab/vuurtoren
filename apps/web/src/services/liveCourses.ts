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
  type Exercise,
  type ExerciseKind,
  type ItemCheck,
  type LanguageProfile,
  type LearnerModel,
  type OcrPage,
  type Unit,
  type UnitWord,
  type WordData,
  assignKinds,
  bookItemKeys,
  checkBookItem,
  detectOutline,
  isVerbSecond,
  migratedProfile,
  normalizeKey,
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
import type { KenningRepository, WordInfo } from "@app/db";
import type { NlpClient } from "@app/nlp-client";
import { createRng, generate } from "../practice/engine.js";
import { type DeriveClient, deriveAnswers } from "./courseDerive.js";
import type {
  AddMissingResult,
  BookCheckResult,
  CourseListItem,
  CourseServices,
  CourseSourceInput,
  CourseView,
  DeckMapping,
  ImportProgress,
  LearnNextResult,
  OutlineRow,
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
}

/** Marker in a Library text's source reference: `course:<courseId>:<unit>`. */
export const courseRef = (courseId: string, unitN: number) => `course:${courseId}:${unitN}`;

const POLL_MS = 1500;
const MAX_PRACTICE_WORDS = 60;

/** Kinds of the practice engine that imitate each book exercise type ("more like this"). */
const KINDS_FOR_TYPE: Partial<Record<BookExercise["type"], ExerciseKind[]>> = {
  gapfill: ["verb-form", "perfect", "cloze-typed"],
  "conjugation-table": ["verb-form"],
  "sentence-building": ["scramble"],
  choice: ["cloze-choice", "word-choice"],
};

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

  /** Run the server OCR job; resolves with all pages. */
  async function ocrPages(
    files: readonly File[],
    onProgress?: (p: ImportProgress) => void,
  ): Promise<OcrPage[]> {
    const client = await deps.nlp();
    const job = await client.courseOcrStart(files, "nl");
    const pages: OcrPage[] = [];
    for (;;) {
      const st = await client.courseOcrStatus(job.id, pages.length);
      pages.push(...st.pages);
      onProgress?.({
        stage: "ocr",
        done: st.done,
        total: st.total || job.total,
        message: `Recognising page ${Math.min(st.done + 1, st.total || job.total)} of ${st.total || job.total}`,
      });
      if (st.status === "error") throw new Error(st.error ?? "OCR failed.");
      if (st.status === "done" && pages.length >= st.total) return pages;
      await new Promise((r) => setTimeout(r, deps.pollMs ?? POLL_MS));
    }
  }

  async function importCourse(
    input: CourseSourceInput,
    onProgress?: (p: ImportProgress) => void,
  ): Promise<string> {
    let pages: OcrPage[];
    let source: Course["source"];
    let title: string;
    if (input.kind === "text") {
      pages = input.text.split("\f").map((text, i) => ({ n: i + 1, text }));
      source = { kind: "text" };
      title = input.title;
    } else {
      const first = input.files[0];
      if (!first) throw new Error("Choose a file first.");
      pages = await ocrPages(input.files, onProgress);
      source = { kind: input.kind, filename: first.name };
      title = input.title?.trim() || fileTitle(first.name);
    }
    if (pages.every((p) => !p.text.trim())) throw new Error("No text was found in this file.");
    onProgress?.({ stage: "outline", done: 0, total: 1, message: "Finding units and exercises" });
    const courseId = crypto.randomUUID();
    const units = detectOutline(pages, courseId);
    const blocks = assignKinds(segmentPages(stripRunningText(pages)), units);
    const course: Course = {
      id: courseId,
      title: title || "Course",
      lang: (await deps.settings()).lang,
      source,
      pageCount: pages.length,
      created: clock(),
    };
    await repo.append({ type: "CourseImported", course });
    await repo.append({ type: "UnitDefined", courseId, units });
    await repo.append({ type: "BlocksExtracted", courseId, blocks });
    onProgress?.({ stage: "outline", done: 1, total: 1, message: "Outline ready" });
    return courseId;
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
  ): Promise<void> {
    const course = await courseOrThrow(courseId);
    const blocks = await repo.courseBlocks(courseId);
    const client = await deps.nlp();
    const derive: DeriveClient = {
      forms: (lang, lemmas) => client.forms(lang, lemmas).catch(() => ({})),
      analyzeText: (lang, texts) => client.analyzeText(lang, texts),
    };
    const themes = course.units.filter((u) => u.kind === "theme" || u.kind === "other");
    const wordLists = unitWordLists(blocks, course.units);

    let step = 0;
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
      exercises = exercises.map((e) =>
        keepUserEdits(
          e,
          previous.find((p) => p.number === e.number),
        ),
      );
      await repo.append({ type: "BookExerciseExtracted", courseId, unitN: unit.n, exercises });
      const words = wordLists.get(unit.n);
      if (words && words.length > 0) {
        await repo.append({ type: "UnitWordsSet", courseId, unitN: unit.n, words });
      }
    }
    const library = await repo.listTexts();
    for (const unit of themes) {
      onProgress?.({ stage: "texts", done: step++, total, message: `Texts of ${unit.title}` });
      for (const t of readingTexts(blocks, unit)) {
        if (library.some((x) => x.title === t.title)) continue;
        await deps.importText({
          kind: "paste",
          title: t.title,
          content: t.text,
          ref: courseRef(courseId, unit.n),
        });
      }
    }
    onProgress?.({ stage: "done", done: total, total, message: "Course ready" });
    deps.changed();
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
      });
    }
    return out;
  }

  async function unitView(courseId: string, n: number): Promise<UnitView | null> {
    const view = await courseView(courseId);
    const row = view?.units.find((r) => r.unit.n === n);
    if (!view || !row) return null;
    const infos = await wordMap();
    const [blocks, exercises, answers, unitWords, library] = await Promise.all([
      repo.courseBlocks(courseId),
      repo.unitExercises(courseId, n),
      repo.bookAnswers(courseId, n),
      repo.unitWords(courseId, n),
      repo.listTexts(),
    ]);
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
      exercises: exercises.map((e) => ({
        ...e,
        answers: e.items.map((_, i) => {
          const a = answers.find((x) => x.number === e.number && x.item === i);
          return a ? { answer: a.answer, correct: a.correct } : {};
        }),
      })),
      words: await wordViews(unitWords, infos),
      grammar: blocks
        .filter((b) => b.kind === "grammar" && b.label && grammarMatches(b, exercises))
        .map((b) => ({ title: b.label ?? "", text: b.text })),
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
    const s = await deps.settings();
    const profile = deps.profile ? await deps.profile() : migratedProfile(s.lang, s.targetDeck, []);
    const course = await courseOrThrow(courseId);
    const unit = course.units.find((u) => u.n === n);
    const context = {
      source: "course" as const,
      course: { title: course.title, ...(unit ? { unitTitle: unit.title } : {}) },
      ...(opts?.deck ? { deck: opts.deck } : {}),
    };
    const infos = await wordMap();
    const missing = (await repo.unitWords(courseId, n)).filter(
      (w) => !infos.get(keyOf(w))?.noteIds.length,
    );
    const anki = await deps.anki();
    const slug = course.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    let added = 0;
    let failed = 0;
    for (const w of missing) {
      try {
        await addWordToAnki(anki, (e) => repo.append(e), {
          profile,
          context,
          word: w.article ? `${w.article} ${w.lemma}` : w.lemma,
          key: keyOf(w),
          source: course.title,
          extraTags: [`kenning::course::${slug}::${n}`],
          ...(w.gloss ? { gloss: w.gloss } : {}),
        });
        added++;
      } catch {
        failed++;
      }
    }
    deps.changed();
    return { added, failed, deck: resolveDeck(profile, context) };
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
    // Round-robin over words and kinds so a session spreads out.
    for (let round = 0; out.length < size && round < kinds.length * 2; round++) {
      for (const w of words) {
        if (out.length >= size) break;
        const kind = kinds[(round + out.length) % kinds.length];
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

  async function checkItem(
    courseId: string,
    n: number,
    number: number,
    item: number,
    answer: string,
  ): Promise<BookCheckResult> {
    const ex = (await repo.unitExercises(courseId, n)).find((e) => e.number === number);
    const it = ex?.items[item];
    if (!ex || !it) throw new Error("This exercise item no longer exists.");
    let orderOk: boolean | undefined;
    if (ex.type === "sentence-building" && answer.trim()) {
      try {
        const [parsed] = await (await deps.nlp()).analyzeText("nl", [answer]);
        orderOk = parsed ? isVerbSecond(parsed.tokens) : undefined;
      } catch {
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
    importCourse,
    analyzeCourse,
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
