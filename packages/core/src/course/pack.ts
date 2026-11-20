/**
 * Course packs: a course as one versioned JSON file.
 *
 * - **full**: everything, including the OCR'd text of the book (blocks, exercise prompts). For
 *   your own backup or to move a course between your own devices; never for sharing.
 * - **structure**: no prose of the book. Units (titles, page ranges, kinds, Anki decks), word
 *   lists (lemma, article), and per exercise its number, page, type and per item a short hash of
 *   the prompt with the answer. Applied on top of your own import of the same book, matched by
 *   page count and a fingerprint of the first line of each page.
 *
 * Pure: building, validating, fingerprinting and applying. Persisting is the app's job.
 */
import { segmentPages, stripRunningText } from "./segment.js";
import type {
  AnswerSource,
  Block,
  BookExercise,
  Course,
  ExerciseItem,
  ExerciseType,
  OcrPage,
  Unit,
  UnitKind,
  UnitWord,
} from "./types.js";

const PACK_FORMAT = "vuurtoren-course-pack";
export const PACK_VERSION = 1;
/** File name suffix of a pack ("de-opmaat-a2.vuurtoren-course.json"). */
const PACK_SUFFIX = ".vuurtoren-course.json";

export type PackMode = "full" | "structure";

/** An exercise item in a pack. Structure packs leave out `prompt`, `options` and `chunks`. */
export interface PackItem extends Partial<Omit<ExerciseItem, "answerSource" | "confidence">> {
  /** {@link itemKey} of the printed prompt: how a structure pack finds the item again. */
  key: string;
  answerSource: AnswerSource;
  confidence: number;
}

/** A book exercise in a pack. Structure packs leave out the text fields. */
export interface PackExercise {
  number: number;
  page: number;
  type: ExerciseType;
  items: PackItem[];
  instruction?: string;
  example?: string;
  raw?: string;
  grammar?: string;
  passage?: string;
}

export interface PackUnit {
  n: number;
  title: string;
  pages: [number, number];
  kind: UnitKind;
  ankiDecks: string[];
  words: UnitWord[];
  exercises: PackExercise[];
}

export interface CoursePack {
  format: typeof PACK_FORMAT;
  version: number;
  mode: PackMode;
  /** ISO time of the export. */
  exported: string;
  course: {
    title: string;
    lang: string;
    level?: string;
    source: Course["source"];
    pageCount: number;
  };
  /** Page number -> {@link lineKey} of the first line of the first block starting there. */
  fingerprint: Record<string, string>;
  units: PackUnit[];
  /** Full packs only: the OCR'd text of the book, as blocks. */
  blocks?: Block[];
  meta?: {
    /** Who or what made the pack ("Vuurtoren", a script name, ...). */
    generator?: string;
    /** Hand corrections made to the pack, counted per category. */
    corrections?: Record<string, number>;
    notes?: string;
  };
}

// ------------------------------------------------------------------ hashing

/** FNV-1a, 32 bit, as 8 hex digits. */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const letters = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[^\p{L}]/gu, "")
    .toLowerCase();

/** Hash of an item's printed prompt, letters only (tolerant of spacing, blanks and digits). */
export function itemKey(prompt: string): string {
  return fnv(letters(prompt));
}

/** Hash of a line for the page fingerprint: its first 24 letters. */
function lineKey(line: string): string {
  return fnv(letters(line).slice(0, 24));
}

/** Fingerprint of a book from its blocks: the first letter-bearing line per page. */
function blocksFingerprint(blocks: readonly Block[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const b of blocks) {
    if (out[b.page] !== undefined) continue;
    const line = [b.label, ...b.text.split("\n")].find(
      (l) => l !== undefined && letters(l).length >= 3,
    );
    if (line) out[b.page] = lineKey(line);
  }
  return out;
}

/** Fingerprint of OCR'd pages, computed the same way as when the pack was exported. */
export function pagesFingerprint(pages: readonly OcrPage[]): Record<string, string> {
  return blocksFingerprint(segmentPages(stripRunningText(pages)));
}

export interface FingerprintMatch {
  /** Pages of the pack's fingerprint that match. */
  matched: number;
  total: number;
  ratio: number;
  samePageCount: boolean;
}

export function compareFingerprints(
  pack: CoursePack,
  pageCount: number,
  own: Record<string, string>,
): FingerprintMatch {
  const entries = Object.entries(pack.fingerprint);
  const matched = entries.filter(([p, h]) => own[p] === h).length;
  return {
    matched,
    total: entries.length,
    ratio: entries.length ? matched / entries.length : 1,
    samePageCount: pageCount === pack.course.pageCount,
  };
}

/** Share of matching fingerprint pages below which a structure pack is for another book. */
export const MIN_FINGERPRINT_MATCH = 0.5;

// ------------------------------------------------------------------ building

export interface CourseContent {
  course: Course;
  units: readonly Unit[];
  blocks: readonly Block[];
  exercises: ReadonlyMap<number, readonly BookExercise[]>;
  words: ReadonlyMap<number, readonly UnitWord[]>;
}

function packItem(it: ExerciseItem, mode: PackMode): PackItem {
  const { prompt, options, chunks, ...rest } = it;
  const out: PackItem = { key: itemKey(prompt), ...rest };
  if (mode === "full") {
    out.prompt = prompt;
    if (options) out.options = options;
    if (chunks) out.chunks = chunks;
  }
  return out;
}

function packExercise(e: BookExercise, mode: PackMode): PackExercise {
  const out: PackExercise = {
    number: e.number,
    page: e.page,
    type: e.type,
    items: e.items.map((it) => packItem(it, mode)),
  };
  if (e.grammar) out.grammar = e.grammar;
  if (mode === "full") {
    out.instruction = e.instruction;
    out.raw = e.raw;
    if (e.example) out.example = e.example;
    if (e.passage) out.passage = e.passage;
  }
  return out;
}

function packWord(w: UnitWord, mode: PackMode): UnitWord {
  if (mode === "full") return { ...w };
  const out: UnitWord = { lemma: w.lemma, source: w.source };
  if (w.article) out.article = w.article;
  if (w.pos) out.pos = w.pos;
  if (w.page !== undefined) out.page = w.page;
  return out;
}

/** A pack of a course. `structure` leaves out every piece of the book's text. */
export function buildCoursePack(
  content: CourseContent,
  mode: PackMode,
  opts: { now?: number; meta?: CoursePack["meta"] } = {},
): CoursePack {
  const { course } = content;
  const pack: CoursePack = {
    format: PACK_FORMAT,
    version: PACK_VERSION,
    mode,
    exported: new Date(opts.now ?? Date.now()).toISOString(),
    course: {
      title: course.title,
      lang: course.lang,
      source: { ...course.source },
      pageCount: course.pageCount,
      ...(course.level ? { level: course.level } : {}),
    },
    fingerprint: blocksFingerprint(content.blocks),
    units: content.units.map((u) => ({
      n: u.n,
      title: u.title,
      pages: [u.pages[0], u.pages[1]],
      kind: u.kind,
      ankiDecks: [...u.ankiDecks],
      words: (content.words.get(u.n) ?? []).map((w) => packWord(w, mode)),
      exercises: (content.exercises.get(u.n) ?? []).map((e) => packExercise(e, mode)),
    })),
  };
  if (mode === "full") pack.blocks = content.blocks.map((b) => ({ ...b }));
  if (opts.meta) pack.meta = opts.meta;
  return pack;
}

/** A structure-only copy of a full pack (what may travel to someone who owns the same book). */
export function structureOnly(pack: CoursePack): CoursePack {
  const { blocks: _blocks, ...rest } = pack;
  void _blocks;
  return {
    ...rest,
    mode: "structure",
    units: pack.units.map((u) => ({
      ...u,
      words: u.words.map((w) => packWord(w, "structure")),
      exercises: u.exercises.map((e) => {
        const out: PackExercise = {
          number: e.number,
          page: e.page,
          type: e.type,
          items: e.items.map((it) => {
            const keep = { ...it };
            delete keep.prompt;
            delete keep.options;
            delete keep.chunks;
            return keep;
          }),
        };
        if (e.grammar) out.grammar = e.grammar;
        return out;
      }),
    })),
  };
}

// ------------------------------------------------------------------ reading back

/** Exercises of a full pack unit as stored by the app. */
export function packExercises(u: PackUnit): BookExercise[] {
  return u.exercises.map((e) => {
    const out: BookExercise = {
      number: e.number,
      page: e.page,
      instruction: e.instruction ?? "",
      type: e.type,
      raw: e.raw ?? "",
      items: e.items.map(({ key: _k, ...it }) => {
        void _k;
        return { ...it, prompt: it.prompt ?? "" };
      }),
    };
    if (e.example) out.example = e.example;
    if (e.grammar) out.grammar = e.grammar;
    if (e.passage) out.passage = e.passage;
    return out;
  });
}

export function packUnits(pack: CoursePack, courseId: string): Unit[] {
  return pack.units.map((u) => ({
    courseId,
    n: u.n,
    title: u.title,
    pages: [u.pages[0], u.pages[1]],
    kind: u.kind,
    ankiDecks: [...u.ankiDecks],
  }));
}

export interface StructureApplied {
  exercises: BookExercise[];
  /** Pack exercises found in your own import and updated. */
  matched: number;
  /** Pack exercises your import does not have (OCR missed the header). */
  missing: number;
  /** Items whose answer came from the pack. */
  items: number;
}

const ITEM_FIELDS = ["answer", "accept", "hint", "person", "first", "tense"] as const;

/**
 * Lay a structure pack's exercises over the exercises recognised from your own pages: the
 * pack's type, and its answers on the items whose prompt hash matches (or by position when
 * both have the same number of items). Your own prompts stay.
 */
export function applyStructure(
  own: readonly BookExercise[],
  pack: readonly PackExercise[],
): StructureApplied {
  let matched = 0;
  let items = 0;
  const out = own.map((e) => {
    const p = pack.find((x) => x.number === e.number);
    if (!p) return e;
    matched++;
    const byKey = new Map(p.items.map((it) => [it.key, it]));
    const sameCount = p.items.length === e.items.length;
    return {
      ...e,
      type: p.type,
      ...(p.grammar ? { grammar: p.grammar } : {}),
      items: e.items.map((it, i) => {
        const src = byKey.get(itemKey(it.prompt)) ?? (sameCount ? p.items[i] : undefined);
        if (!src) return it;
        items++;
        const next: ExerciseItem = {
          ...it,
          answerSource: src.answerSource,
          confidence: src.confidence,
        };
        for (const f of ITEM_FIELDS) {
          if (src[f] !== undefined) Object.assign(next, { [f]: src[f] });
        }
        return next;
      }),
    };
  });
  const missing = pack.filter((p) => !own.some((e) => e.number === p.number)).length;
  return { exercises: out, matched, missing, items };
}

// ------------------------------------------------------------------ validation

const UNIT_KINDS: readonly UnitKind[] = ["theme", "grammar", "transcripts", "wordlist", "other"];
const EXERCISE_TYPES: readonly ExerciseType[] = [
  "gapfill",
  "conjugation-table",
  "sentence-building",
  "choice",
  "matching",
  "open-task",
  "listening",
  "unknown",
];
const ANSWER_SOURCES: readonly AnswerSource[] = ["book", "derived", "user", "ai"];
const BLOCK_KINDS = ["text", "exercise", "wordlist", "grammar", "transcript", "other"];

export class CoursePackError extends Error {
  override name = "CoursePackError";
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isStr = (v: unknown): v is string => typeof v === "string";

/**
 * Check that a parsed JSON value is a course pack this app can read, and return it typed.
 * Throws {@link CoursePackError} with a message for the user.
 */
export function parseCoursePack(value: unknown): CoursePack {
  const fail = (msg: string): never => {
    throw new CoursePackError(msg);
  };
  if (!isObj(value) || value["format"] !== PACK_FORMAT)
    fail("This file is not a Vuurtoren course pack.");
  const v = value as Record<string, unknown>;
  const version = v["version"];
  if (!isInt(version) || version < 1) fail("This course pack has no valid version.");
  if ((version as number) > PACK_VERSION)
    fail(
      `This course pack was made by a newer version of Vuurtoren (pack version ${String(version)}; this app reads version ${PACK_VERSION}). Update Vuurtoren and try again.`,
    );
  const mode = v["mode"];
  if (mode !== "full" && mode !== "structure") fail("The pack's mode must be full or structure.");
  const course = v["course"];
  if (!isObj(course)) return fail("The pack has no course.");
  if (!isStr(course["title"]) || !course["title"].trim()) fail("The course has no title.");
  if (!isStr(course["lang"])) fail("The course has no language.");
  const pageCount = course["pageCount"];
  if (!isInt(pageCount) || pageCount < 1) fail("The course has no page count.");
  const source = course["source"];
  if (!isObj(source) || !["pdf", "images", "text", "url"].includes(String(source["kind"])))
    fail("The course has no valid source.");
  if (!isObj(v["fingerprint"])) fail("The pack has no page fingerprint.");
  const units = v["units"];
  if (!Array.isArray(units) || units.length === 0) fail("The pack has no units.");
  const seen = new Set<number>();
  for (const [i, u] of (units as unknown[]).entries()) {
    const at = `Unit ${i + 1}`;
    if (!isObj(u)) return fail(`${at} is not valid.`);
    if (!isInt(u["n"]) || seen.has(u["n"])) fail(`${at} has no unique number.`);
    seen.add(u["n"] as number);
    if (!isStr(u["title"])) fail(`${at} has no title.`);
    const pages = u["pages"];
    if (
      !Array.isArray(pages) ||
      pages.length !== 2 ||
      !isInt(pages[0]) ||
      !isInt(pages[1]) ||
      pages[0] < 1 ||
      pages[1] < pages[0] ||
      pages[1] > (pageCount as number)
    )
      fail(`${at} has no valid page range.`);
    if (!UNIT_KINDS.includes(u["kind"] as UnitKind)) fail(`${at} has an unknown kind.`);
    if (!Array.isArray(u["ankiDecks"]) || !u["ankiDecks"].every(isStr))
      fail(`${at} has no deck list.`);
    const words = u["words"];
    if (!Array.isArray(words)) return fail(`${at} has no word list.`);
    for (const w of words) {
      if (!isObj(w) || !isStr(w["lemma"]) || !w["lemma"].trim())
        fail(`${at} has a word without a lemma.`);
    }
    const exercises = u["exercises"];
    if (!Array.isArray(exercises)) return fail(`${at} has no exercise list.`);
    for (const e of exercises) {
      if (!isObj(e) || !isInt(e["number"]) || !isInt(e["page"]))
        return fail(`${at} has an exercise without a number or page.`);
      const ex = `${at}, exercise ${String(e["number"])}`;
      if (!EXERCISE_TYPES.includes(e["type"] as ExerciseType)) fail(`${ex} has an unknown type.`);
      const items = e["items"];
      if (!Array.isArray(items)) return fail(`${ex} has no items.`);
      for (const it of items) {
        if (
          !isObj(it) ||
          !isStr(it["key"]) ||
          !ANSWER_SOURCES.includes(it["answerSource"] as AnswerSource) ||
          typeof it["confidence"] !== "number"
        )
          fail(`${ex} has an item that is not valid.`);
        if (mode === "full" && !isStr((it as Record<string, unknown>)["prompt"]))
          fail(`${ex} has an item without its text (a full pack needs it).`);
      }
    }
  }
  const blocks = v["blocks"];
  if (mode === "full") {
    if (!Array.isArray(blocks)) fail("A full pack needs the book's text (blocks).");
    for (const b of blocks as unknown[]) {
      if (
        !isObj(b) ||
        !isInt(b["page"]) ||
        !isStr(b["text"]) ||
        !BLOCK_KINDS.includes(String(b["kind"])) ||
        (b["topic"] !== undefined && !isStr(b["topic"]))
      )
        fail("The pack has a text block that is not valid.");
    }
  } else if (blocks !== undefined) {
    fail("A structure pack must not contain the book's text.");
  }
  return value as unknown as CoursePack;
}

/** Counts for the import preview. */
export interface PackSummary {
  title: string;
  mode: PackMode;
  pageCount: number;
  units: {
    n: number;
    title: string;
    kind: UnitKind;
    pages: [number, number];
    words: number;
    exercises: number;
  }[];
  words: number;
  exercises: number;
  items: number;
  answers: number;
  blocks: number;
  corrections: number;
}

export function summarizePack(pack: CoursePack): PackSummary {
  const units = pack.units.map((u) => ({
    n: u.n,
    title: u.title,
    kind: u.kind,
    pages: u.pages,
    words: u.words.length,
    exercises: u.exercises.length,
  }));
  const items = pack.units.flatMap((u) => u.exercises.flatMap((e) => e.items));
  return {
    title: pack.course.title,
    mode: pack.mode,
    pageCount: pack.course.pageCount,
    units,
    words: units.reduce((s, u) => s + u.words, 0),
    exercises: units.reduce((s, u) => s + u.exercises, 0),
    items: items.length,
    answers: items.filter((i) => i.answer).length,
    blocks: pack.blocks?.length ?? 0,
    corrections: Object.values(pack.meta?.corrections ?? {}).reduce((s, n) => s + n, 0),
  };
}

/** A file name for a pack: "de-opmaat-a2.vuurtoren-course.json" / "...structure.vuurtoren-course.json". */
export function packFileName(title: string, mode: PackMode): string {
  const slug =
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "course";
  return `${slug}${mode === "structure" ? ".structure" : ""}${PACK_SUFFIX}`;
}
