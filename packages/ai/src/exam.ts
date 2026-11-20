/**
 * Exam preparation with AI: new A2 practice items for Lezen and Luisteren written
 * around the learner's vocabulary (validated like stories: coverage check with one rewrite), and
 * feedback on a written or (typed) spoken answer against the task's checklist.
 */
import type { AnalyzedToken, LearnerModel } from "@app/core";
import { coverageReport, type CoverageReport } from "./coverage.js";
import { extractJson } from "./json.js";
import { addUsage, asString } from "./util.js";
import type { AIProvider, ChatMessage, Usage } from "./types.js";

export type ExamItemPart = "lezen" | "luisteren";

export interface ExamItemSetup {
  part: ExamItemPart;
  /** Everyday situation, e.g. "a letter from the gemeente" (default: the model chooses). */
  topic?: string;
  vocabEstimate: number;
  /** Relevant known lemmas (see `selectKnownLemmas`). */
  knownLemmas: string[];
}

export interface GeneratedQuestion {
  q: string;
  options: string[];
  answer: number;
  explain: string;
}

export interface GeneratedExamItem {
  title: string;
  /** Lezen: the text. Luisteren: the context line shown before playing. */
  text: string;
  /** Luisteren only: the spoken lines. */
  lines: { who: string; voice: "f" | "m"; text: string }[];
  questions: GeneratedQuestion[];
  vocab: Record<string, string>;
}

export interface ExamItemDeps {
  provider: AIProvider;
  analyze: (text: string) => Promise<AnalyzedToken[]>;
  model: LearnerModel;
  /** Coverage below this triggers the one rewrite. Default 0.95. */
  threshold?: number;
  signal?: AbortSignal;
}

export interface ExamItemResult {
  /** Null when the model's answer was not a valid item (nothing usable). */
  item: GeneratedExamItem | null;
  coverage: number | null;
  unknown: string[];
  rewritten: boolean;
  usage: Usage;
}

const SHAPE: Record<ExamItemPart, string> = {
  lezen:
    '{"title": "short Dutch title", "text": "the Dutch text (60-140 words; use \\n for line breaks)", "questions": [{"q": "Dutch question", "options": ["A", "B", "C"], "answer": 0, "explain": "one short English sentence"}], "vocab": {"dutch lemma": "English gloss"}}',
  luisteren:
    '{"title": "short Dutch title", "text": "one Dutch sentence describing the situation", "lines": [{"who": "role in Dutch", "voice": "f or m", "text": "what they say"}], "questions": [{"q": "Dutch question", "options": ["A", "B", "C"], "answer": 0, "explain": "one short English sentence"}], "vocab": {"dutch lemma": "English gloss"}}',
};

const KIND: Record<ExamItemPart, string> = {
  lezen:
    "a short everyday reading text like those in the Dutch civic integration exam (inburgeringsexamen) Reading A2: a letter from the gemeente, a notice, a sign, an advert, a timetable or an e-mail",
  luisteren:
    "a short everyday listening fragment like those in the Dutch civic integration exam (inburgeringsexamen) Listening A2: a dialogue of 3-6 turns, a phone call, a voicemail or a public announcement",
};

/** The system prompt of an exam-item request. */
export function buildExamItemPrompt(s: ExamItemSetup): string {
  return [
    "You write ORIGINAL practice items for Dutch learners at CEFR level A2. Never copy official exam items.",
    `Write ${KIND[s.part]}.`,
    `The learner knows roughly ${s.vocabEstimate} Dutch words.`,
    "",
    "Rules:",
    "- Plain, correct, natural Dutch at A2: short sentences, everyday words, concrete facts (times, days, prices, places).",
    "- Prefer words from the learner's vocabulary below plus very common function words. Names and numbers are fine.",
    "- Exactly 2 or 3 multiple-choice questions in Dutch, each with exactly 3 options; one is clearly right from the text, the others are plausible but wrong.",
    "- `answer` is the 0-based index of the right option. Vary its position.",
    "- `vocab`: 3-5 useful words from the text (Dutch lemma -> English).",
    "",
    "Answer with ONE JSON object and nothing else, exactly in this shape:",
    SHAPE[s.part],
    "",
    `Learner vocabulary (${s.knownLemmas.length} words): ${s.knownLemmas.join(", ")}`,
  ].join("\n");
}

/** Validate the model's JSON into an item, or null when it is not usable. */
export function parseExamItem(text: string, part: ExamItemPart): GeneratedExamItem | null {
  const j = extractJson(text);
  if (!j) return null;
  const body = asString(j["text"]).replace(/\\n/g, "\n");
  const lines = Array.isArray(j["lines"])
    ? j["lines"]
        .map((l) => {
          const o = (l ?? {}) as Record<string, unknown>;
          const voice: "f" | "m" = asString(o["voice"]).toLowerCase().startsWith("m") ? "m" : "f";
          return { who: asString(o["who"]) || "Spreker", voice, text: asString(o["text"]) };
        })
        .filter((l) => l.text)
    : [];
  const questions = (Array.isArray(j["questions"]) ? j["questions"] : [])
    .map((raw): GeneratedQuestion | null => {
      const o = (raw ?? {}) as Record<string, unknown>;
      const options = Array.isArray(o["options"]) ? o["options"].map(asString).filter(Boolean) : [];
      const answer = typeof o["answer"] === "number" ? o["answer"] : -1;
      const q = asString(o["q"] ?? o["question"]);
      if (
        !q ||
        options.length < 2 ||
        options.length > 4 ||
        new Set(options).size !== options.length
      )
        return null;
      if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) return null;
      return { q, options, answer, explain: asString(o["explain"]) };
    })
    .filter((q): q is GeneratedQuestion => q !== null);
  const vocab: Record<string, string> = {};
  if (j["vocab"] && typeof j["vocab"] === "object" && !Array.isArray(j["vocab"])) {
    for (const [k, v] of Object.entries(j["vocab"] as Record<string, unknown>)) {
      if (k.trim() && asString(v)) vocab[k.trim()] = asString(v);
    }
  }
  if (!body || questions.length === 0) return null;
  if (part === "luisteren" && lines.length === 0) return null;
  return { title: asString(j["title"]) || "Oefening", text: body, lines, questions, vocab };
}

/** The Dutch text whose coverage is checked: the text, or the spoken lines. */
function itemText(item: GeneratedExamItem, part: ExamItemPart): string {
  return part === "luisteren" ? item.lines.map((l) => l.text).join("\n") : item.text;
}

/** Write one practice item: ask, check coverage, rewrite once if needed (kept if not worse). */
export async function generateExamItem(
  deps: ExamItemDeps,
  setup: ExamItemSetup,
): Promise<ExamItemResult> {
  const threshold = deps.threshold ?? 0.95;
  const system = buildExamItemPrompt(setup);
  let usage: Usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
  const request: ChatMessage = {
    role: "user",
    content: `Write the item now.${setup.topic?.trim() ? ` Situation: ${setup.topic.trim()}.` : ""}`,
  };
  const ask = async (messages: ChatMessage[]) => {
    const res = await deps.provider.chat({
      system,
      messages,
      json: true,
      maxTokens: 1500,
      ...(deps.signal ? { signal: deps.signal } : {}),
    });
    usage = addUsage(usage, res.usage);
    return { raw: res.text, item: parseExamItem(res.text, setup.part) };
  };
  const check = async (item: GeneratedExamItem): Promise<CoverageReport | null> => {
    try {
      return coverageReport(await deps.analyze(itemText(item, setup.part)), deps.model);
    } catch {
      return null; // NLP server down: keep the item, skip the check
    }
  };

  const first = await ask([request]);
  let item = first.item;
  let report = item ? await check(item) : null;
  let rewritten = false;
  if (item && report && report.coverage < threshold && report.unknown.length > 0) {
    rewritten = true;
    const second = await ask([
      request,
      { role: "assistant", content: first.raw },
      {
        role: "user",
        content:
          `These words are outside my vocabulary: ${report.unknown.slice(0, 30).join(", ")}. ` +
          "Rewrite the item with simpler words I know; keep the situation and the question format. Answer with the same JSON object only.",
      },
    ]);
    if (second.item) {
      const r2 = await check(second.item);
      if (r2 && r2.coverage >= report.coverage) {
        item = second.item;
        report = r2;
      }
    }
  }
  return {
    item,
    coverage: report ? report.coverage : null,
    unknown: report ? report.unknown : [],
    rewritten,
    usage,
  };
}

export interface ExamFeedbackInput {
  part: "schrijven" | "spreken";
  /** The task as the learner saw it (situation and question). */
  task: string;
  /** What the answer must contain. */
  points: string[];
  answer: string;
  minWords?: number;
}

export interface ExamFeedback {
  /** One or two sentences in English. */
  summary: string;
  /** One verdict per checklist point, in the order given. */
  points: { point: string; ok: boolean; note: string }[];
  corrections: { wrong: string; right: string; why: string }[];
  /** The learner's answer, corrected and kept at A2. */
  improved: string;
  /** The model did not answer in the expected format; `summary` holds its raw text. */
  parseFailed: boolean;
}

/** Feedback on a written answer or a typed transcript of a spoken one, like an A2 examiner. */
export async function examFeedback(
  provider: AIProvider,
  input: ExamFeedbackInput,
  opts: { signal?: AbortSignal } = {},
): Promise<ExamFeedback> {
  const what = input.part === "schrijven" ? "written answer" : "spoken answer (typed transcript)";
  const system = [
    "You are a friendly examiner for the Dutch civic integration exam at CEFR A2.",
    `Judge the learner's ${what} against the task and its checklist. A2 means: simple sentences, small errors are fine if the message is clear.`,
    "Write all feedback in English; corrections and the improved answer in Dutch at A2.",
    "Answer with ONE JSON object and nothing else, exactly in this shape:",
    '{"summary": "1-2 sentences", "points": [{"point": "checklist item", "ok": true, "note": "short"}], "corrections": [{"wrong": "learner text", "right": "corrected", "why": "short reason"}], "improved": "the corrected answer"}',
    "List at most 6 corrections, most important first.",
  ].join("\n");
  const content = [
    `Task: ${input.task}`,
    `Checklist:\n${input.points.map((p) => `- ${p}`).join("\n")}`,
    input.minWords ? `Minimum words: ${input.minWords}` : "",
    `Answer:\n${input.answer}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const res = await provider.chat({
    system,
    messages: [{ role: "user", content }],
    json: true,
    maxTokens: 1500,
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  const j = extractJson(res.text);
  if (!j) {
    return {
      summary: res.text.trim(),
      points: [],
      corrections: [],
      improved: "",
      parseFailed: true,
    };
  }
  const list = (v: unknown) => (Array.isArray(v) ? v : []) as Record<string, unknown>[];
  const verdicts = list(j["points"]);
  return {
    summary: asString(j["summary"]),
    points: input.points.map((point, i) => {
      const v = verdicts[i] ?? {};
      return { point, ok: v["ok"] === true, note: asString(v["note"]) };
    }),
    corrections: list(j["corrections"])
      .map((c) => ({
        wrong: asString(c["wrong"]),
        right: asString(c["right"]),
        why: asString(c["why"]),
      }))
      .filter((c) => c.wrong && c.right)
      .slice(0, 6),
    improved: asString(j["improved"]),
    parseFailed: false,
  };
}
