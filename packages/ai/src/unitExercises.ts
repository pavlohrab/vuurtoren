/**
 * "Generate exercises like this unit" (docs/ai.md, Unit exercises).
 *
 * One request asks for new exercises of the kinds the book's unit has (gap fill, sentence
 * building, questions about a short text) using the unit's words and, when the unit's texts
 * show one, its grammar point. Nothing is trusted: every sentence is analysed by the language
 * server and kept only if
 *
 * - a gap fill's sentence contains its unit word (reader matcher) and the blank is that word;
 * - the other words are known (the unit's words count as known) at the coverage threshold;
 * - 4-14 words per sentence;
 * - for a grammar topic, the rule-based detector fires (sentence building always needs it when
 *   a topic is given);
 * - a text reaches the coverage threshold and each question's right option shares a word with
 *   the text.
 *
 * Matching (word and meaning) is built without AI from the unit words' glosses. The result is
 * plain {@link BookExercise} data: the app stores it as an event and grades it with the book
 * checkers (`checkBookItem`), never with the model.
 */
import {
  type AnalyzedToken,
  type BookExercise,
  type ExerciseItem,
  type LearnerModel,
  normalizeKey,
} from "@app/core";
import { coverageReport, findTargets } from "./coverage.js";
import type { SentenceGrammarHit } from "./examples.js";
import { extractJson } from "./json.js";
import type { AIProvider, SystemPrompt, Usage } from "./types.js";

export type UnitExerciseKind = "gapfill" | "sentence-building" | "questions" | "matching";

export interface UnitExerciseWord {
  lemma: string;
  article?: string;
  gloss?: string;
}

export interface UnitExerciseSetup {
  unitTitle: string;
  /** Unit words to practise (the first ~12 are sent). */
  words: UnitExerciseWord[];
  /** The grammar point the unit's texts show, when one was detected. */
  grammar?: { id: string; title: string; summary?: string; detects: string[] };
  /** Kinds to make (from the book's own exercise types). */
  kinds: UnitExerciseKind[];
  vocabEstimate: number;
  knownLemmas: string[];
  /** Language name for the prompt ("Dutch"). */
  language?: string;
  /** Items per exercise (default 6). */
  items?: number;
}

export interface UnitExerciseDeps {
  provider: AIProvider;
  analyze: (text: string) => Promise<AnalyzedToken[]>;
  model: LearnerModel;
  detectGrammar?: (text: string) => Promise<SentenceGrammarHit[]>;
  /** Minimum coverage (default 0.9). */
  minCoverage?: number;
  /** Deterministic shuffling in tests. */
  random?: () => number;
  signal?: AbortSignal;
}

export type UnitRejectReason =
  "length" | "missing-target" | "blank" | "coverage" | "grammar" | "analysis" | "options" | "text";

export interface UnitExerciseResult {
  /** New exercises (numbers are assigned by the caller). */
  exercises: Omit<BookExercise, "number" | "page">[];
  rejected: { text: string; reason: UnitRejectReason }[];
  parseFailed: boolean;
  usage: Usage;
}

const MIN_WORDS = 4;
const MAX_WORDS = 14;
const MAX_TARGETS = 12;

const wordCount = (s: string) => s.match(/\p{L}+(?:['’-]\p{L}+)*/gu)?.length ?? 0;

export function buildUnitExercisePrompt(s: UnitExerciseSetup): SystemPrompt {
  const lang = s.language ?? "Dutch";
  return {
    cached: [
      `You write ${lang} textbook exercises for an adult learner who knows roughly ${s.vocabEstimate} words.`,
      "Use ONLY words from the learner's vocabulary list and the unit's words, plus very common function words. Names and numbers are fine.",
      `Every sentence: ${MIN_WORDS} to ${MAX_WORDS} words, natural everyday ${lang}.`,
      "",
      "Answer with ONE JSON object and nothing else, in this shape (leave out parts you are not asked for):",
      "{",
      '  "gapfill": [{"sentence": "full sentence", "answer": "the exact word form that goes in the gap", "lemma": "its dictionary form"}],',
      '  "order": [{"sentence": "full sentence"}],',
      '  "text": {"title": "...", "text": "a short text of 80-120 words", "questions": [{"question": "...", "options": ["...", "...", "..."], "answer": 0}]}',
      "}",
      "",
      `Learner vocabulary (${s.knownLemmas.length} words): ${s.knownLemmas.join(", ")}`,
    ].join("\n"),
  };
}

export function unitExerciseRequestText(s: UnitExerciseSetup): string {
  const n = s.items ?? 6;
  const words = s.words.slice(0, MAX_TARGETS).map((w) => w.lemma);
  const parts = [
    `The unit is "${s.unitTitle}". Its words: ${words.join(", ")}.`,
    s.grammar
      ? `Its grammar point: ${s.grammar.title}${s.grammar.summary ? ` (${s.grammar.summary})` : ""}.`
      : "",
  ];
  if (s.kinds.includes("gapfill"))
    parts.push(
      `"gapfill": ${n} sentences, each using one of the unit's words (a different one each time); "answer" is that word as it appears in the sentence.`,
    );
  if (s.kinds.includes("sentence-building"))
    parts.push(
      `"order": ${n} sentences with the unit's words${s.grammar ? " that clearly show the grammar point" : ""}; the learner will put the words in order.`,
    );
  if (s.kinds.includes("questions"))
    parts.push(
      `"text": a short text about the unit's topic using several of its words, with 4 multiple-choice questions about it (3 options each, "answer" is the index of the right option).`,
    );
  return parts.filter(Boolean).join("\n");
}

/** Shuffle a copy (Fisher-Yates) that is never the identity for 2+ distinct items. */
function shuffled<T>(xs: readonly T[], random: () => number): T[] {
  const out = [...xs];
  for (let attempt = 0; attempt < 5; attempt++) {
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    if (out.some((x, i) => x !== xs[i])) return out;
  }
  return out.reverse();
}

/** Chunks of a sentence for sentence building: 3-6 groups of words, punctuation dropped. */
export function sentenceChunks(sentence: string, max = 6): string[] {
  const words = sentence
    .replace(/[.!?]+$/u, "")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length <= max) return words;
  const size = Math.ceil(words.length / max);
  const out: string[] = [];
  for (let i = 0; i < words.length; i += size) out.push(words.slice(i, i + size).join(" "));
  return out;
}

const asString = (v: unknown) => (typeof v === "string" ? v.trim() : "");

interface Parsed {
  gapfill: { sentence: string; answer: string; lemma: string }[];
  order: { sentence: string }[];
  text?: {
    title: string;
    text: string;
    questions: { question: string; options: string[]; answer: number }[];
  };
}

export function parseUnitExercises(raw: string): Parsed | undefined {
  const j = extractJson(raw);
  if (!j) return undefined;
  const list = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v)
      ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
      : [];
  const out: Parsed = {
    gapfill: list(j["gapfill"])
      .map((o) => ({
        sentence: asString(o["sentence"]),
        answer: asString(o["answer"]),
        lemma: asString(o["lemma"]),
      }))
      .filter((g) => g.sentence && g.answer),
    order: list(j["order"])
      .map((o) => ({ sentence: asString(o["sentence"]) }))
      .filter((o) => o.sentence),
  };
  const t = j["text"];
  if (t && typeof t === "object") {
    const o = t as Record<string, unknown>;
    const questions = list(o["questions"])
      .map((q) => ({
        question: asString(q["question"]),
        options: Array.isArray(q["options"]) ? q["options"].map(asString).filter(Boolean) : [],
        answer: typeof q["answer"] === "number" ? q["answer"] : -1,
      }))
      .filter((q) => q.question);
    const text = asString(o["text"]);
    if (text) out.text = { title: asString(o["title"]), text, questions };
  }
  return out;
}

/** Make the unit's exercises; see the module comment for the checks. */
export async function generateUnitExercises(
  deps: UnitExerciseDeps,
  setup: UnitExerciseSetup,
): Promise<UnitExerciseResult> {
  const random = deps.random ?? Math.random;
  const minCov = deps.minCoverage ?? 0.9;
  const unitKeys = new Set(setup.words.map((w) => normalizeKey(w.lemma)));
  const rejected: UnitExerciseResult["rejected"] = [];
  const exercises: UnitExerciseResult["exercises"] = [];
  const n = setup.items ?? 6;

  // Matching needs no AI: the unit's words and their glosses.
  if (setup.kinds.includes("matching")) {
    const glossed = setup.words.filter((w) => w.gloss?.trim());
    if (glossed.length >= 4) {
      const pick = shuffled(glossed, random).slice(0, Math.min(n, glossed.length));
      const items: ExerciseItem[] = pick.map((w) => {
        const others = shuffled(
          glossed.filter((x) => x.lemma !== w.lemma),
          random,
        ).slice(0, 3);
        const options = shuffled([w, ...others], random).map((x) => x.gloss ?? "");
        return {
          prompt: w.article ? `${w.article} ${w.lemma}` : w.lemma,
          options,
          answer: w.gloss ?? "",
          answerSource: "ai",
          confidence: 1,
        };
      });
      exercises.push({
        instruction: "Match each word with its meaning.",
        type: "choice",
        items,
        raw: "",
      });
    }
  }

  const aiKinds = setup.kinds.filter((k) => k !== "matching");
  if (aiKinds.length === 0) {
    return { exercises, rejected, parseFailed: false, usage: { inputTokens: 0, outputTokens: 0 } };
  }
  const res = await deps.provider.chat({
    system: buildUnitExercisePrompt(setup),
    messages: [{ role: "user", content: unitExerciseRequestText({ ...setup, kinds: aiKinds }) }],
    json: true,
    maxTokens: 2500,
    ...(deps.signal ? { signal: deps.signal } : {}),
  });
  const usage: Usage = res.usage ?? { inputTokens: 0, outputTokens: 0 };
  const parsed = parseUnitExercises(res.text);
  if (!parsed) return { exercises, rejected, parseFailed: true, usage };

  /** Shared sentence checks; returns the tokens, or the reason to reject. */
  const check = async (
    sentence: string,
    needGrammar: boolean,
  ): Promise<{ tokens: AnalyzedToken[] } | UnitRejectReason> => {
    const words = wordCount(sentence);
    if (words < MIN_WORDS || words > MAX_WORDS) return "length";
    let tokens: AnalyzedToken[];
    try {
      tokens = await deps.analyze(sentence);
    } catch {
      return "analysis";
    }
    const report = coverageReport(tokens, deps.model, unitKeys);
    if (report.coverage < minCov || report.unknown.length > 1) return "coverage";
    if (needGrammar && setup.grammar) {
      if (!deps.detectGrammar) return "grammar";
      try {
        const hits = await deps.detectGrammar(sentence);
        if (!hits.some((h) => setup.grammar?.detects.includes(h.topic))) return "grammar";
      } catch {
        return "analysis";
      }
    }
    return { tokens };
  };

  if (aiKinds.includes("gapfill")) {
    const items: ExerciseItem[] = [];
    for (const g of parsed.gapfill.slice(0, n + 2)) {
      const key = normalizeKey(g.lemma || g.answer);
      const v = await check(g.sentence, false);
      if (typeof v === "string") {
        rejected.push({ text: g.sentence, reason: v });
        continue;
      }
      // The gap must be a unit word, really present in the sentence as the given form.
      const target = [...findTargets(v.tokens, [...unitKeys]).entries()].find(
        ([k, t]) =>
          k === key || g.sentence.slice(t.start, t.end).toLowerCase() === g.answer.toLowerCase(),
      );
      if (!target) {
        rejected.push({ text: g.sentence, reason: "missing-target" });
        continue;
      }
      const [lemma, tok] = target;
      const form = g.sentence.slice(tok.start, tok.end);
      if (form.toLowerCase() !== g.answer.toLowerCase()) {
        rejected.push({ text: g.sentence, reason: "blank" });
        continue;
      }
      items.push({
        prompt: `${g.sentence.slice(0, tok.start)}____ (${lemma})${g.sentence.slice(tok.end)}`,
        hint: lemma,
        answer: form,
        answerSource: "ai",
        confidence: 1,
      });
      if (items.length >= n) break;
    }
    if (items.length > 0)
      exercises.push({
        instruction: "Fill in the right form of the word in brackets.",
        type: "gapfill",
        items,
        raw: "",
      });
  }

  if (aiKinds.includes("sentence-building")) {
    const items: ExerciseItem[] = [];
    for (const o of parsed.order.slice(0, n + 2)) {
      const v = await check(o.sentence, true);
      if (typeof v === "string") {
        rejected.push({ text: o.sentence, reason: v });
        continue;
      }
      if (findTargets(v.tokens, [...unitKeys]).size === 0) {
        rejected.push({ text: o.sentence, reason: "missing-target" });
        continue;
      }
      const chunks = shuffled(sentenceChunks(o.sentence), random);
      items.push({
        prompt: chunks.join(" / "),
        chunks,
        answer: o.sentence,
        answerSource: "ai",
        confidence: 1,
      });
      if (items.length >= n) break;
    }
    if (items.length > 0)
      exercises.push({
        instruction: "Make sentences: put the words in the right order.",
        type: "sentence-building",
        items,
        raw: "",
        ...(setup.grammar ? { grammar: setup.grammar.id } : {}),
      });
  }

  if (aiKinds.includes("questions") && parsed.text) {
    const t = parsed.text;
    let tokens: AnalyzedToken[] = [];
    let ok = true;
    try {
      tokens = await deps.analyze(t.text);
      const report = coverageReport(tokens, deps.model, unitKeys);
      if (report.coverage < minCov) {
        ok = false;
        rejected.push({ text: t.title || t.text.slice(0, 40), reason: "coverage" });
      }
    } catch {
      ok = false;
      rejected.push({ text: t.title || t.text.slice(0, 40), reason: "analysis" });
    }
    if (ok) {
      const textWords = new Set(tokens.filter((x) => x.is_word).map((x) => normalizeKey(x.lemma)));
      const surface = new Set((t.text.toLowerCase().match(/\p{L}{3,}/gu) ?? []).map(String));
      const items: ExerciseItem[] = [];
      for (const q of t.questions) {
        const right = q.options[q.answer];
        const distinct = new Set(q.options.map((x) => x.toLowerCase())).size === q.options.length;
        if (!right || q.options.length < 2 || !distinct) {
          rejected.push({ text: q.question, reason: "options" });
          continue;
        }
        const words = right.toLowerCase().match(/\p{L}{3,}/gu) ?? [];
        if (!words.some((w) => surface.has(w) || textWords.has(normalizeKey(w)))) {
          rejected.push({ text: q.question, reason: "text" });
          continue;
        }
        items.push({
          prompt: q.question,
          options: q.options,
          answer: right,
          answerSource: "ai",
          confidence: 1,
        });
      }
      if (items.length > 0)
        exercises.push({
          instruction: `Read the text${t.title ? ` "${t.title}"` : ""}. Choose the right answer.`,
          type: "choice",
          passage: t.text,
          items,
          raw: "",
        });
    }
  }
  return { exercises, rejected, parseFailed: false, usage };
}
