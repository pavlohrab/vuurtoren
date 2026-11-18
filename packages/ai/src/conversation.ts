/**
 * Vocabulary-constrained conversation (docs/research/05-ai-byok.md).
 *
 * 1. A static system prompt carries level, topic, 200-400 relevant known lemmas, target words
 *    and the JSON contract (cacheable: it never changes within a conversation).
 * 2. Each reply is analysed and its coverage computed against the learner model.
 * 3. Below the threshold: exactly ONE rewrite request naming the offending words.
 * 4. Whatever words remain unknown are glossed instead of blocking the conversation.
 */
import type { AnalyzedToken, LearnerModel } from "@app/core";
import { normalizeKey } from "@app/core";
import { coverageReport } from "./coverage.js";
import { extractJson } from "./json.js";
import type { AIProvider, ChatMessage, SystemPrompt, Usage } from "./types.js";

export interface Correction {
  original: string;
  corrected: string;
  explanation: string;
}
export interface NewWord {
  lemma: string;
  gloss: string;
  example: string;
}
/** What the model returns for one turn. */
export interface TurnOutput {
  reply: string;
  corrections: Correction[];
  newWords: NewWord[];
}

export interface ConversationSetup {
  topic: string;
  /** About how many lemmas the learner knows (the "frequency band" in the prompt). */
  vocabEstimate: number;
  /** Relevant known lemmas (see `selectKnownLemmas`). */
  knownLemmas: string[];
  /** Words the partner should work in (unit / "introduce" words or the learner's choice). */
  targetWords: string[];
  /** Language of glosses and explanations. */
  explainIn?: string;
  /** Most new (unknown) words per reply. */
  maxNewPerTurn?: number;
}

/** Cap on known lemmas sent in the prompt (token budget: ~2 tokens per lemma). */
const MAX_PROMPT_LEMMAS = 400;

/** Minimal word info needed to pick prompt lemmas. */
export interface WordLite {
  key: string;
  state: string;
  pKnown: number;
}

/**
 * Pick up to `max` known/learning lemmas for the prompt: words mentioned in the topic first,
 * then words being learned (so they get practice), then an even spread over the rest.
 */
export function selectKnownLemmas(
  words: readonly WordLite[],
  topic: string,
  max: number = 300,
): string[] {
  const cap = Math.min(max, MAX_PROMPT_LEMMAS);
  const usable = words.filter(
    (w) => (w.state === "known" || w.state === "learning") && !/\s/.test(w.key),
  );
  const topicWords = new Set(topic.toLowerCase().match(/\p{L}+/gu) ?? []);
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (k: string) => {
    if (out.length < cap && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  };
  for (const w of usable) if (topicWords.has(w.key.toLowerCase())) add(w.key);
  for (const w of usable.filter((x) => x.state === "learning").slice(0, Math.floor(cap / 3))) {
    add(w.key);
  }
  const rest = usable.filter((w) => w.state === "known" && !seen.has(w.key));
  const room = cap - out.length;
  if (room > 0 && rest.length > 0) {
    const step = Math.max(1, rest.length / room);
    for (let i = 0; i < rest.length && out.length < cap; i = Math.round(i + step) || i + 1) {
      add(rest[Math.floor(i)]!.key);
    }
  }
  return out;
}

/** The static (cacheable) system prompt of a conversation. */
export function buildSystemPrompt(s: ConversationSetup): SystemPrompt {
  const maxNew = s.maxNewPerTurn ?? 2;
  const explain = s.explainIn ?? "English";
  const lines = [
    "You are a friendly conversation partner helping an adult learn Dutch.",
    `The learner knows roughly ${s.vocabEstimate} Dutch words. Topic of the conversation: ${s.topic}.`,
    "",
    "Rules for every reply:",
    "- Write Dutch only, 1 to 3 short sentences, then ask one simple question to keep the conversation going.",
    "- Use ONLY words from the learner's vocabulary list below plus very common function words (articles, pronouns, prepositions, basic verbs). Names and numbers are fine.",
    `- You may introduce at most ${maxNew} new words per reply, always from the target words if they fit. List every new word in new_words.`,
    "- Check the learner's last message. If it contains mistakes, give each correction; otherwise leave corrections empty. Keep it kind and brief.",
    `- Write glosses and explanations in ${explain}.`,
    "",
    "Answer with ONE JSON object and nothing else, exactly in this shape:",
    '{"reply": "Dutch text", "corrections": [{"original": "...", "corrected": "...", "explanation": "..."}], "new_words": [{"lemma": "dictionary form", "gloss": "short meaning", "example": "short Dutch example"}]}',
    "",
    `Learner vocabulary (${s.knownLemmas.length} words): ${s.knownLemmas.join(", ")}`,
  ];
  if (s.targetWords.length) lines.push("", `Target words to practise: ${s.targetWords.join(", ")}`);
  return { cached: lines.join("\n") };
}

const asString = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Validate the model's JSON; drops malformed list items instead of failing the whole turn. */
export function parseTurn(
  text: string,
): { ok: true; turn: TurnOutput } | { ok: false; turn: TurnOutput; error: string } {
  const j = extractJson(text);
  const reply = j ? asString(j["reply"]) : "";
  if (!j || !reply) {
    // Show the raw text rather than nothing: a partly useful reply beats an error.
    return {
      ok: false,
      turn: { reply: text.trim(), corrections: [], newWords: [] },
      error: j ? "The reply had no text." : "The reply was not valid JSON.",
    };
  }
  const list = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v)
      ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
      : [];
  const corrections = list(j["corrections"])
    .map((c) => ({
      original: asString(c["original"] ?? c["orig"]),
      corrected: asString(c["corrected"] ?? c["fixed"]),
      explanation: asString(c["explanation"] ?? c["rule"]),
    }))
    .filter((c) => c.original && c.corrected);
  const newWords = list(j["new_words"])
    .map((w) => ({
      lemma: asString(w["lemma"]),
      gloss: asString(w["gloss"]),
      example: asString(w["example"]),
    }))
    .filter((w) => w.lemma);
  return { ok: true, turn: { reply, corrections, newWords } };
}

/** How an assistant turn is replayed to the model, so it keeps answering in JSON. */
export function assistantHistoryMessage(turn: TurnOutput): ChatMessage {
  return {
    role: "assistant",
    content: JSON.stringify({ reply: turn.reply, corrections: [], new_words: turn.newWords }),
  };
}

export interface TurnDeps {
  provider: AIProvider;
  /** Analyse Dutch text into tokens (NLP server). May throw: coverage is then unavailable. */
  analyze: (text: string) => Promise<AnalyzedToken[]>;
  model: LearnerModel;
  /** Coverage below this triggers the one rewrite. Default 0.95. */
  threshold?: number;
  /** Short translations for leftover unknown lemmas (optional). */
  glossFor?: (lemmas: string[]) => Promise<Record<string, string>>;
  signal?: AbortSignal;
}

export interface TurnResult {
  turn: TurnOutput;
  /** Coverage of the final reply, or null when analysis was unavailable. */
  coverage: number | null;
  /** Unknown lemmas left in the final reply (declared new words excluded). */
  unknown: string[];
  /** Glosses for `unknown` (when a gloss source was given). */
  glosses: Record<string, string>;
  rewritten: boolean;
  /** The model did not return valid JSON; `turn.reply` is its raw text. */
  parseFailed: boolean;
  usage: Usage;
}

const START_PROMPT =
  "(Start the conversation: greet me briefly and ask a first simple question about the topic.)";

function addUsage(a: Usage, b: Usage | undefined): Usage {
  if (!b) return a;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cachedTokens: (a.cachedTokens ?? 0) + (b.cachedTokens ?? 0),
  };
}

/**
 * One conversation turn: ask, check coverage, rewrite once if needed, gloss what is left.
 * @param history earlier messages (assistant turns via `assistantHistoryMessage`)
 * @param userText the learner's message; empty to open the conversation
 */
export async function runTurn(
  deps: TurnDeps,
  setup: ConversationSetup,
  history: readonly ChatMessage[],
  userText: string,
): Promise<TurnResult> {
  const threshold = deps.threshold ?? 0.95;
  const system = buildSystemPrompt(setup);
  const userMessage: ChatMessage = { role: "user", content: userText.trim() || START_PROMPT };
  const messages = [...history, userMessage];
  const targetKeys = setup.targetWords.map(normalizeKey);
  let usage: Usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };

  const ask = async (msgs: ChatMessage[]) => {
    const res = await deps.provider.chat({
      system,
      messages: msgs,
      json: true,
      ...(deps.signal ? { signal: deps.signal } : {}),
    });
    usage = addUsage(usage, res.usage);
    return { raw: res.text, parsed: parseTurn(res.text) };
  };
  const check = async (turn: TurnOutput) => {
    try {
      const tokens = await deps.analyze(turn.reply);
      const allowed = new Set([...targetKeys, ...turn.newWords.map((w) => normalizeKey(w.lemma))]);
      return coverageReport(tokens, deps.model, allowed);
    } catch {
      return null; // NLP server down: skip the check, never block the conversation
    }
  };

  const first = await ask(messages);
  let final = first.parsed;
  let report = await check(final.turn);
  let rewritten = false;

  if (final.ok && report && report.coverage < threshold && report.unknown.length > 0) {
    rewritten = true;
    const second = await ask([
      ...messages,
      { role: "assistant", content: first.raw },
      {
        role: "user",
        content:
          `Your reply used words outside my vocabulary: ${report.unknown.join(", ")}. ` +
          "Rewrite your reply with simpler words I know (keep the meaning and the question). " +
          "Keep the corrections of my message. Answer with the same JSON object only.",
      },
    ]);
    if (second.parsed.ok) {
      const r2 = await check(second.parsed.turn);
      // Keep the rewrite unless it somehow made things worse.
      if (!r2 || r2.coverage >= report.coverage) {
        final = second.parsed;
        report = r2;
      }
    }
  }

  let glosses: Record<string, string> = {};
  const unknown = report?.unknown ?? [];
  if (unknown.length && deps.glossFor) {
    try {
      glosses = await deps.glossFor(unknown);
    } catch {
      /* glosses are a bonus */
    }
  }
  return {
    turn: final.turn,
    coverage: report ? report.coverage : null,
    unknown,
    glosses,
    rewritten,
    parseFailed: !final.ok,
    usage,
  };
}
