/**
 * AI stories (docs/ai.md, Stories): a short Dutch text written for the learner, kept to the
 * words they know and working in a few target words.
 *
 * 1. One request with level, 200-400 relevant known lemmas, the target words, an optional
 *    grammar topic and style; JSON answer {title, text, used_targets}.
 * 2. The text is analysed and its coverage computed with the reader's matcher (target words
 *    count as known: they are meant to be new).
 * 3. Below the threshold: exactly ONE rewrite naming the offending words; it is kept only if
 *    coverage does not drop.
 * 4. Target words are checked in the analysed text (lemma match), not taken from the model's
 *    own `used_targets` claim.
 */
import type { AnalyzedToken, LearnerModel } from "@app/core";
import { normalizeKey } from "@app/core";
import { type CoverageReport, coverageReport, findTargets } from "./coverage.js";
import { extractJson } from "./json.js";
import { addUsage, asString } from "./util.js";
import type { AIProvider, ChatMessage, SystemPrompt, Usage } from "./types.js";

export type StoryLength = "short" | "medium" | "long";
export type StoryStyle = "story" | "dialogue" | "news" | "letter";

/** Approximate word counts per length. */
export const STORY_WORDS: Record<StoryLength, number> = { short: 150, medium: 300, long: 600 };

const STYLE_TEXT: Record<StoryStyle, string> = {
  story: "a short story with a clear beginning and end",
  dialogue: "a dialogue between two people (write each line as 'Name: text')",
  news: "a simple news article",
  letter: "a personal letter or e-mail",
};

export interface StorySetup {
  topic: string;
  length: StoryLength;
  style?: StoryStyle;
  /** About how many lemmas the learner knows. */
  vocabEstimate: number;
  /** Relevant known lemmas (see `selectKnownLemmas`). */
  knownLemmas: string[];
  /** Words the story should use (new or shaky words). */
  targetWords: string[];
  /** A grammar construction to feature, e.g. {title: "Inversion", summary: "..."}. */
  grammar?: { title: string; summary?: string };
}

export interface StoryDeps {
  provider: AIProvider;
  /** Analyse Dutch text (NLP server). May throw: coverage and the target check are then skipped. */
  analyze: (text: string) => Promise<AnalyzedToken[]>;
  model: LearnerModel;
  /** Coverage below this triggers the one rewrite. Default 0.95. */
  threshold?: number;
  /** Called between steps, for a progress line. */
  onProgress?: (step: "writing" | "checking" | "rewriting") => void;
  signal?: AbortSignal;
}

export interface StoryResult {
  title: string;
  text: string;
  /** Target words the model says it used (its claim). */
  claimedTargets: string[];
  /** Target words found in the analysed text (null when analysis was unavailable). */
  foundTargets: string[] | null;
  /** Target words that are not in the text (empty when analysis was unavailable). */
  missingTargets: string[];
  /** Coverage of the final text, or null when analysis was unavailable. */
  coverage: number | null;
  /** Unknown lemmas left in the final text (target words excluded). */
  unknown: string[];
  rewritten: boolean;
  /** The model did not return valid JSON; `text` is its raw answer. */
  parseFailed: boolean;
  usage: Usage;
}

/** Most offending words named in the rewrite request. */
const MAX_NAMED = 40;

/** The static system prompt of a story request. */
export function buildStoryPrompt(s: StorySetup): SystemPrompt {
  const words = STORY_WORDS[s.length];
  const lines = [
    "You write Dutch reading texts for an adult learner.",
    `The learner knows roughly ${s.vocabEstimate} Dutch words.`,
    "",
    "Rules:",
    `- Write ${STYLE_TEXT[s.style ?? "story"]} of about ${words} words, in Dutch only.`,
    "- Use ONLY words from the learner's vocabulary list below plus very common function words (articles, pronouns, prepositions, basic verbs). Names and numbers are fine.",
    "- Short sentences, everyday language, paragraphs separated by a blank line.",
  ];
  if (s.targetWords.length) {
    lines.push(
      "- Use every target word at least once, in a context that makes its meaning clear; use each again later if it fits.",
    );
  }
  if (s.grammar) {
    lines.push(
      `- Feature this grammar point in several sentences: ${s.grammar.title}${s.grammar.summary ? ` (${s.grammar.summary})` : ""}.`,
    );
  }
  lines.push(
    "",
    "Answer with ONE JSON object and nothing else, exactly in this shape:",
    '{"title": "short Dutch title", "text": "the Dutch text", "used_targets": ["target words you used"]}',
    "",
    `Learner vocabulary (${s.knownLemmas.length} words): ${s.knownLemmas.join(", ")}`,
  );
  if (s.targetWords.length) lines.push("", `Target words: ${s.targetWords.join(", ")}`);
  return { cached: lines.join("\n") };
}

/** Validate the model's JSON. Invalid JSON: the raw text becomes the story (never lose a paid answer). */
export function parseStory(
  text: string,
  fallbackTitle: string,
): { ok: boolean; title: string; text: string; usedTargets: string[] } {
  const j = extractJson(text);
  const body = j ? asString(j["text"] ?? j["story"]) : "";
  if (!j || !body) {
    return { ok: false, title: fallbackTitle, text: text.trim(), usedTargets: [] };
  }
  const used = Array.isArray(j["used_targets"])
    ? j["used_targets"].filter((x): x is string => typeof x === "string").map((x) => x.trim())
    : [];
  return { ok: true, title: asString(j["title"]) || fallbackTitle, text: body, usedTargets: used };
}

/** Rough token estimate for a story request (prompt + answer, one rewrite included). */
export function estimateStoryTokens(s: Pick<StorySetup, "length" | "knownLemmas">): {
  input: number;
  output: number;
} {
  const prompt = 350 + s.knownLemmas.length * 3;
  const answer = Math.round(STORY_WORDS[s.length] * 1.8) + 60;
  // A rewrite resends the prompt plus the first answer.
  return { input: prompt * 2 + answer, output: answer * 2 };
}

/** Write one story: ask, check coverage and target words, rewrite once if needed. */
export async function generateStory(deps: StoryDeps, setup: StorySetup): Promise<StoryResult> {
  const threshold = deps.threshold ?? 0.95;
  const system = buildStoryPrompt(setup);
  const targetKeys = setup.targetWords.map(normalizeKey).filter(Boolean);
  const allowed = new Set(targetKeys);
  const fallbackTitle = setup.topic.trim() || "Verhaal";
  const words = STORY_WORDS[setup.length];
  // Room for the story in JSON plus a model's thinking: a short story still gets 4,096.
  const maxTokens = Math.max(4096, Math.round(words * 6));
  let usage: Usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };

  const request: ChatMessage = {
    role: "user",
    content: `Write the text now. Topic: ${setup.topic.trim() || "everyday life"}.`,
  };
  const ask = async (messages: ChatMessage[]) => {
    const res = await deps.provider.chat({
      system,
      messages,
      json: true,
      maxTokens,
      ...(deps.signal ? { signal: deps.signal } : {}),
    });
    usage = addUsage(usage, res.usage);
    return { raw: res.text, parsed: parseStory(res.text, fallbackTitle) };
  };
  const check = async (
    text: string,
  ): Promise<{ report: CoverageReport; found: string[] } | null> => {
    try {
      const tokens = await deps.analyze(text);
      return {
        report: coverageReport(tokens, deps.model, allowed),
        found: [...findTargets(tokens, targetKeys).keys()],
      };
    } catch {
      return null; // NLP server down: keep the story, skip the checks
    }
  };

  deps.onProgress?.("writing");
  const first = await ask([request]);
  let final = first.parsed;
  deps.onProgress?.("checking");
  let checked = final.ok ? await check(final.text) : null;
  let rewritten = false;

  if (
    final.ok &&
    checked &&
    checked.report.coverage < threshold &&
    checked.report.unknown.length > 0
  ) {
    rewritten = true;
    deps.onProgress?.("rewriting");
    const missing = targetKeys.filter((k) => !checked!.found.includes(k));
    const second = await ask([
      request,
      { role: "assistant", content: first.raw },
      {
        role: "user",
        content:
          `The text used words outside my vocabulary: ${checked.report.unknown.slice(0, MAX_NAMED).join(", ")}. ` +
          "Rewrite it with simpler words I know; keep the story, its length and the target words" +
          (missing.length ? ` (also use: ${missing.join(", ")})` : "") +
          ". Answer with the same JSON object only.",
      },
    ]);
    if (second.parsed.ok) {
      const c2 = await check(second.parsed.text);
      // Keep the rewrite only if coverage did not drop.
      if (c2 && c2.report.coverage >= checked.report.coverage) {
        final = second.parsed;
        checked = c2;
      }
    }
  }

  const found = checked ? checked.found : null;
  return {
    title: final.title,
    text: final.text,
    claimedTargets: final.usedTargets,
    foundTargets: found,
    missingTargets: found ? targetKeys.filter((k) => !found.includes(k)) : [],
    coverage: checked ? checked.report.coverage : null,
    unknown: checked ? checked.report.unknown : [],
    rewritten,
    parseFailed: !final.ok,
    usage,
  };
}
