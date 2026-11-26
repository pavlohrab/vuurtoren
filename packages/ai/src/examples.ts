/**
 * AI example sentences for practice (docs/ai.md, AI example sentences).
 *
 * The model writes K short sentences for a target lemma (and/or a grammar topic) using the
 * learner's vocabulary. Nothing is trusted: every sentence is analysed by the NLP server and
 * kept only if the target lemma is really there (reader matcher, separable verbs included), the
 * other words are known, no other target word leaks in, the length fits and, for a grammar
 * topic, the rule-based detector fires for that topic. Rejected sentences are dropped and
 * counted. Grading stays with the non-AI exercise generators.
 */
import type { AnalyzedToken, LearnerModel } from "@app/core";
import { normalizeKey } from "@app/core";
import { coverageReport, findTargets } from "./coverage.js";
import { extractJson } from "./json.js";
import { wordCount } from "./util.js";
import type { AIProvider, SystemPrompt, Usage } from "./types.js";

/** A grammar detector hit, as returned by the NLP server's `/grammar` (one sentence text). */
export interface SentenceGrammarHit {
  topic: string;
  /** Token indices into the analysis of the same text. */
  tokens: number[];
  start: number;
  end: number;
  note: string;
}

export interface SentenceSetup {
  /** Target lemma (practice key). Omit for grammar-topic-only sentences. */
  lemma?: string;
  /** Grammar topic the sentences must show; `detects` are the detector ids that count. */
  grammar?: { title: string; summary?: string; detects: string[] };
  /** Sentences to ask for (default 5). */
  count?: number;
  vocabEstimate: number;
  knownLemmas: string[];
  /** Language of the translations (default English). */
  explainIn?: string;
}

export interface SentenceDeps {
  provider: AIProvider;
  analyze: (text: string) => Promise<AnalyzedToken[]>;
  model: LearnerModel;
  /** Grammar detection of one sentence (needed when `setup.grammar` is given). */
  detectGrammar?: (text: string) => Promise<SentenceGrammarHit[]>;
  /** Other target words (e.g. this session's) that must not appear in the sentence. */
  avoid?: readonly string[];
  /** Texts already available for this target (duplicates are dropped). */
  existing?: readonly string[];
  /** Minimum coverage of the words other than the target (default 0.9). */
  minCoverage?: number;
  /** Most unknown words other than the target (default 1). */
  maxUnknown?: number;
  minWords?: number;
  maxWords?: number;
  signal?: AbortSignal;
}

export interface AcceptedSentence {
  text: string;
  translation?: string;
  /** [start, end) of the target word (when a lemma was given). */
  target?: [number, number];
  /** [start, end) spans of the grammar construction (when a grammar topic was given). */
  marks?: [number, number][];
  note?: string;
}

export type RejectReason =
  "length" | "missing-target" | "coverage" | "leak" | "grammar" | "duplicate" | "analysis";

export interface SentenceResult {
  accepted: AcceptedSentence[];
  rejected: { text: string; reason: RejectReason }[];
  /** The model's answer was not valid JSON (nothing could be checked). */
  parseFailed: boolean;
  usage: Usage;
}

const SENTENCE_MIN_WORDS = 4;
const SENTENCE_MAX_WORDS = 14;

/**
 * The static system prompt (vocabulary and rules only), so that the target of each request goes
 * into the user message and providers can cache this part across lemmas.
 */
function buildSentencePrompt(
  s: Pick<SentenceSetup, "vocabEstimate" | "knownLemmas" | "explainIn">,
): SystemPrompt {
  const explain = s.explainIn ?? "English";
  return {
    cached: [
      "You write short Dutch example sentences for an adult learner.",
      `The learner knows roughly ${s.vocabEstimate} Dutch words.`,
      "",
      "Rules for every sentence:",
      `- ${SENTENCE_MIN_WORDS} to ${SENTENCE_MAX_WORDS} words, natural everyday Dutch, one sentence each, all different.`,
      // Practice builds and hears sentences of 4 to 7 words (algorithms.md 4.7): ask for enough.
      "- Make at least half of them short, 4 to 7 words.",
      "- Use ONLY words from the learner's vocabulary list below plus very common function words, besides the requested word. Names and numbers are fine.",
      "- The context should make the meaning of the requested word clear.",
      `- Give a translation into ${explain} for each sentence.`,
      "",
      "Answer with ONE JSON object and nothing else, exactly in this shape:",
      '{"sentences": [{"text": "Dutch sentence", "translation": "translation"}]}',
      "",
      `Learner vocabulary (${s.knownLemmas.length} words): ${s.knownLemmas.join(", ")}`,
    ].join("\n"),
  };
}

/** The user message naming what this request is for. */
export function sentenceRequestText(s: SentenceSetup): string {
  const n = s.count ?? 5;
  const parts = [`Write ${n} sentences.`];
  if (s.lemma) parts.push(`Each sentence must use the word "${s.lemma}" (any form).`);
  if (s.grammar) {
    parts.push(
      `Each sentence must clearly show this grammar point: ${s.grammar.title}${s.grammar.summary ? ` (${s.grammar.summary})` : ""}.`,
    );
  }
  return parts.join(" ");
}

/** Sentences of the model's JSON (both `sentences` objects and plain strings are accepted). */
export function parseSentences(text: string): { text: string; translation?: string }[] | undefined {
  const j = extractJson(text);
  const list = j?.["sentences"];
  if (!Array.isArray(list)) return undefined;
  const out: { text: string; translation?: string }[] = [];
  for (const item of list) {
    if (typeof item === "string" && item.trim()) out.push({ text: item.trim() });
    else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const t = typeof o["text"] === "string" ? o["text"].trim() : "";
      const tr = typeof o["translation"] === "string" ? o["translation"].trim() : "";
      if (t) out.push(tr ? { text: t, translation: tr } : { text: t });
    }
  }
  return out;
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Check one sentence.
 * @returns the accepted sentence, or the reason it was rejected
 */
async function validateSentence(
  deps: SentenceDeps,
  setup: Pick<SentenceSetup, "lemma" | "grammar">,
  candidate: { text: string; translation?: string },
): Promise<AcceptedSentence | RejectReason> {
  const { text } = candidate;
  const n = wordCount(text);
  if (n < (deps.minWords ?? SENTENCE_MIN_WORDS) || n > (deps.maxWords ?? SENTENCE_MAX_WORDS)) {
    return "length";
  }
  let tokens: AnalyzedToken[];
  try {
    tokens = await deps.analyze(text);
  } catch {
    return "analysis";
  }
  const out: AcceptedSentence = { text };
  if (candidate.translation) out.translation = candidate.translation;
  const target = setup.lemma ? normalizeKey(setup.lemma) : null;
  if (target) {
    const tok = findTargets(tokens, [target]).get(target);
    if (!tok) return "missing-target";
    out.target = [tok.start, tok.end];
  }
  const report = coverageReport(tokens, deps.model, new Set(target ? [target] : []));
  if (
    report.unknown.length > (deps.maxUnknown ?? 1) ||
    report.coverage < (deps.minCoverage ?? 0.9)
  ) {
    return "coverage";
  }
  const avoid = (deps.avoid ?? []).map(normalizeKey).filter((k) => k && k !== target);
  if (avoid.length && findTargets(tokens, avoid).size > 0) return "leak";
  if (setup.grammar) {
    if (!deps.detectGrammar) return "grammar";
    let hits: SentenceGrammarHit[];
    try {
      hits = await deps.detectGrammar(text);
    } catch {
      return "analysis";
    }
    const wanted = new Set(setup.grammar.detects);
    const hit = hits.find((h) => wanted.has(h.topic));
    if (!hit) return "grammar";
    const marks = hit.tokens
      .map((i) => tokens[i])
      .filter((t): t is AnalyzedToken => !!t && t.start >= hit.start && t.end <= hit.end)
      .map((t) => [t.start, t.end] as [number, number])
      .sort((a, b) => a[0] - b[0]);
    out.marks = marks.length ? marks : [[hit.start, hit.end]];
    if (hit.note) out.note = hit.note;
  }
  return out;
}

/** Ask for sentences and keep only the ones that pass `validateSentence`. */
export async function generateSentences(
  deps: SentenceDeps,
  setup: SentenceSetup,
): Promise<SentenceResult> {
  const res = await deps.provider.chat({
    system: buildSentencePrompt(setup),
    messages: [{ role: "user", content: sentenceRequestText(setup) }],
    json: true,
    maxTokens: 1500,
    ...(deps.signal ? { signal: deps.signal } : {}),
  });
  const usage: Usage = res.usage ?? { inputTokens: 0, outputTokens: 0 };
  const candidates = parseSentences(res.text);
  if (!candidates) {
    return { accepted: [], rejected: [], parseFailed: true, usage };
  }
  const seen = new Set((deps.existing ?? []).map(norm));
  const accepted: AcceptedSentence[] = [];
  const rejected: SentenceResult["rejected"] = [];
  for (const c of candidates) {
    if (seen.has(norm(c.text))) {
      rejected.push({ text: c.text, reason: "duplicate" });
      continue;
    }
    seen.add(norm(c.text));
    const v = await validateSentence(deps, setup, c);
    if (typeof v === "string") rejected.push({ text: c.text, reason: v });
    else accepted.push(v);
  }
  return { accepted, rejected, parseFailed: false, usage };
}
