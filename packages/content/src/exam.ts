/**
 * Exam-preparation content (`exam/<exam id>/*.json`): original practice items in the formats of
 * an official exam (for now the Dutch inburgeringsexamen A2, docs/research/08-inburgering-a2.md).
 * Self-contained like parse.ts: scripts/generate.ts runs this file directly with Node's type
 * stripping, so it must not import anything at runtime.
 */

export type ExamPart = "lezen" | "luisteren" | "schrijven" | "spreken" | "knm";
export const EXAM_PARTS: readonly ExamPart[] = [
  "lezen",
  "luisteren",
  "schrijven",
  "spreken",
  "knm",
];

/** A multiple-choice question (Lezen, Luisteren, KNM). `answer` indexes `options`. */
export interface McQuestion {
  id: string;
  q: string;
  options: string[];
  answer: number;
  /** Short explanation shown after answering (English). */
  explain: string;
}

/** Lemma -> English gloss of the words worth learning in an item. */
export type Vocab = Record<string, string>;

export interface ReadingText {
  id: string;
  /** Mock exam this text belongs to (1, 2, …). */
  set: number;
  kind: "letter" | "sign" | "ad" | "schedule" | "email" | "notice";
  title: string;
  text: string;
  vocab: Vocab;
  questions: McQuestion[];
}

export interface ListeningLine {
  who: string;
  /** Voice for text-to-speech: female or male (pitch only; one Dutch voice is enough). */
  voice: "f" | "m";
  text: string;
}

export interface ListeningFragment {
  id: string;
  set: number;
  kind: "dialogue" | "announcement" | "voicemail";
  /** The situation shown before playing (as in the exam). */
  context: string;
  lines: ListeningLine[];
  vocab: Vocab;
  questions: McQuestion[];
}

export interface FormField {
  label: string;
  model: string;
  /** The answer must be a whole sentence (the last field of an A2 form). */
  sentence?: boolean;
}

export interface WritingTask {
  id: string;
  set: number;
  kind: "form" | "note" | "email" | "message";
  title: string;
  situation: string;
  /** Form tasks only. */
  fields?: FormField[];
  /** What the answer must contain (task-specific checklist). */
  points: string[];
  /** Free writing: minimum number of words. */
  minWords?: number;
  /** Free writing: a model answer. */
  model?: string;
  /** Grammar topic ids (packages/content/grammar) the task practises. */
  grammar: string[];
}

export interface SpeakingPrompt {
  id: string;
  set: number;
  kind: "short" | "long" | "opinion" | "story";
  situation: string;
  question: string;
  /** Answer time in seconds. */
  seconds: number;
  model: string;
  points: string[];
  grammar: string[];
}

export interface KnmTheme {
  id: string;
  title: string;
  en: string;
  questions: McQuestion[];
}

export interface ExamBank {
  id: string;
  lezen: ReadingText[];
  luisteren: ListeningFragment[];
  schrijven: { tasks: WritingTask[]; rubric: { form: string[]; message: string[] } };
  spreken: { prompts: SpeakingPrompt[]; rubric: string[] };
  knm: KnmTheme[];
}

/** Error naming the file and item, so broken content fails the build with a clear message. */
export class ExamContentError extends Error {
  override readonly name = "ExamContentError";
}

type Obj = Record<string, unknown>;

function fail(where: string, msg: string): never {
  throw new ExamContentError(`${where}: ${msg}`);
}
function obj(v: unknown, where: string): Obj {
  if (!v || typeof v !== "object" || Array.isArray(v)) fail(where, "expected an object");
  return v as Obj;
}
function arr(v: unknown, where: string): unknown[] {
  if (!Array.isArray(v)) fail(where, "expected a list");
  return v;
}
function str(v: unknown, where: string): string {
  if (typeof v !== "string" || !v.trim()) fail(where, "expected a non-empty string");
  return v;
}
function strs(v: unknown, where: string, allowEmpty = false): string[] {
  const a = arr(v, where).map((x, i) => str(x, `${where}[${i}]`));
  if (!allowEmpty && a.length === 0) fail(where, "expected at least one entry");
  return a;
}
function num(v: unknown, where: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) fail(where, "expected an integer");
  return v;
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[], where: string): T {
  if (!allowed.includes(v as T)) fail(where, `expected one of ${allowed.join(", ")}`);
  return v as T;
}

function vocab(v: unknown, where: string): Vocab {
  const o = obj(v ?? {}, where);
  for (const [k, g] of Object.entries(o)) str(g, `${where}.${k}`);
  return o as Vocab;
}

function questions(v: unknown, where: string, ids: Set<string>): McQuestion[] {
  const list = arr(v, where);
  if (list.length === 0) fail(where, "expected at least one question");
  return list.map((raw, i) => {
    const w = `${where}[${i}]`;
    const q = obj(raw, w);
    const id = str(q["id"], `${w}.id`);
    if (ids.has(id)) fail(w, `duplicate id ${id}`);
    ids.add(id);
    const options = strs(q["options"], `${w}.options`);
    if (options.length < 2 || options.length > 4) fail(w, "expected 2–4 options");
    if (new Set(options).size !== options.length) fail(w, "options must differ");
    const answer = num(q["answer"], `${w}.answer`);
    if (answer >= options.length) fail(w, "answer out of range");
    return {
      id,
      q: str(q["q"], `${w}.q`),
      options,
      answer,
      explain: str(q["explain"], `${w}.explain`),
    };
  });
}

function unique(id: string, ids: Set<string>, where: string): string {
  if (ids.has(id)) fail(where, `duplicate id ${id}`);
  ids.add(id);
  return id;
}

/**
 * Validate the parsed JSON files of one exam (`lezen.json`, …) into an ExamBank. Ids are unique
 * across the whole bank; `grammar` lists are checked against `grammarIds` when given.
 */
export function parseExamBank(
  id: string,
  files: Record<ExamPart, unknown>,
  grammarIds?: ReadonlySet<string>,
): ExamBank {
  const ids = new Set<string>();
  const grammar = (v: unknown, where: string) => {
    const list = strs(v ?? [], where, true);
    if (grammarIds) {
      for (const g of list) if (!grammarIds.has(g)) fail(where, `unknown grammar topic ${g}`);
    }
    return list;
  };

  const lz = obj(files.lezen, `${id}/lezen`);
  const lezen = arr(lz["texts"], `${id}/lezen.texts`).map((raw, i): ReadingText => {
    const w = `${id}/lezen.texts[${i}]`;
    const t = obj(raw, w);
    return {
      id: unique(str(t["id"], `${w}.id`), ids, w),
      set: num(t["set"], `${w}.set`),
      kind: oneOf(t["kind"], ["letter", "sign", "ad", "schedule", "email", "notice"], `${w}.kind`),
      title: str(t["title"], `${w}.title`),
      text: str(t["text"], `${w}.text`),
      vocab: vocab(t["vocab"], `${w}.vocab`),
      questions: questions(t["questions"], `${w}.questions`, ids),
    };
  });

  const lu = obj(files.luisteren, `${id}/luisteren`);
  const luisteren = arr(lu["fragments"], `${id}/luisteren.fragments`).map(
    (raw, i): ListeningFragment => {
      const w = `${id}/luisteren.fragments[${i}]`;
      const f = obj(raw, w);
      const lines = arr(f["lines"], `${w}.lines`).map((l, j) => {
        const lw = `${w}.lines[${j}]`;
        const o = obj(l, lw);
        return {
          who: str(o["who"], `${lw}.who`),
          voice: oneOf(o["voice"], ["f", "m"], `${lw}.voice`),
          text: str(o["text"], `${lw}.text`),
        };
      });
      if (lines.length === 0) fail(w, "expected at least one line");
      return {
        id: unique(str(f["id"], `${w}.id`), ids, w),
        set: num(f["set"], `${w}.set`),
        kind: oneOf(f["kind"], ["dialogue", "announcement", "voicemail"], `${w}.kind`),
        context: str(f["context"], `${w}.context`),
        lines,
        vocab: vocab(f["vocab"], `${w}.vocab`),
        questions: questions(f["questions"], `${w}.questions`, ids),
      };
    },
  );

  const sc = obj(files.schrijven, `${id}/schrijven`);
  const tasks = arr(sc["tasks"], `${id}/schrijven.tasks`).map((raw, i): WritingTask => {
    const w = `${id}/schrijven.tasks[${i}]`;
    const t = obj(raw, w);
    const kind = oneOf(t["kind"], ["form", "note", "email", "message"], `${w}.kind`);
    const task: WritingTask = {
      id: unique(str(t["id"], `${w}.id`), ids, w),
      set: num(t["set"], `${w}.set`),
      kind,
      title: str(t["title"], `${w}.title`),
      situation: str(t["situation"], `${w}.situation`),
      points: strs(t["points"], `${w}.points`),
      grammar: grammar(t["grammar"], `${w}.grammar`),
    };
    if (kind === "form") {
      task.fields = arr(t["fields"], `${w}.fields`).map((f, j) => {
        const fw = `${w}.fields[${j}]`;
        const o = obj(f, fw);
        return {
          label: str(o["label"], `${fw}.label`),
          model: str(o["model"], `${fw}.model`),
          ...(o["sentence"] === true ? { sentence: true } : {}),
        };
      });
      if (task.fields.length === 0) fail(w, "a form needs fields");
    } else {
      task.model = str(t["model"], `${w}.model`);
      task.minWords = num(t["minWords"], `${w}.minWords`);
    }
    return task;
  });
  const rubric = obj(sc["rubric"], `${id}/schrijven.rubric`);

  const sp = obj(files.spreken, `${id}/spreken`);
  const prompts = arr(sp["prompts"], `${id}/spreken.prompts`).map((raw, i): SpeakingPrompt => {
    const w = `${id}/spreken.prompts[${i}]`;
    const p = obj(raw, w);
    const seconds = num(p["seconds"], `${w}.seconds`);
    if (seconds < 10 || seconds > 180) fail(w, "seconds must be 10–180");
    return {
      id: unique(str(p["id"], `${w}.id`), ids, w),
      set: num(p["set"], `${w}.set`),
      kind: oneOf(p["kind"], ["short", "long", "opinion", "story"], `${w}.kind`),
      situation: str(p["situation"], `${w}.situation`),
      question: str(p["question"], `${w}.question`),
      seconds,
      model: str(p["model"], `${w}.model`),
      points: strs(p["points"], `${w}.points`),
      grammar: grammar(p["grammar"], `${w}.grammar`),
    };
  });

  const kn = obj(files.knm, `${id}/knm`);
  const knm = arr(kn["themes"], `${id}/knm.themes`).map((raw, i): KnmTheme => {
    const w = `${id}/knm.themes[${i}]`;
    const t = obj(raw, w);
    return {
      id: unique(str(t["id"], `${w}.id`), ids, w),
      title: str(t["title"], `${w}.title`),
      en: str(t["en"], `${w}.en`),
      questions: questions(t["questions"], `${w}.questions`, ids),
    };
  });

  return {
    id,
    lezen,
    luisteren,
    schrijven: {
      tasks,
      rubric: {
        form: strs(rubric["form"], `${id}/schrijven.rubric.form`),
        message: strs(rubric["message"], `${id}/schrijven.rubric.message`),
      },
    },
    spreken: { prompts, rubric: strs(sp["rubric"], `${id}/spreken.rubric`) },
    knm,
  };
}
