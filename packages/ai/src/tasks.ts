/** One-shot helpers for the reader: explain a sentence, simplify a page with re-scoring. */
import type { AnalyzedToken, LearnerModel } from "@app/core";
import { coverageReport } from "./coverage.js";
import type { AIProvider } from "./types.js";

/** Short grammar + meaning explanation of one Dutch sentence, in plain text. */
export async function explainSentence(
  provider: AIProvider,
  sentence: string,
  opts: { vocabEstimate: number; explainIn?: string } = { vocabEstimate: 1000 },
): Promise<string> {
  const lang = opts.explainIn ?? "English";
  const res = await provider.chat({
    system:
      `You are a concise Dutch tutor. The learner knows about ${opts.vocabEstimate} Dutch words. ` +
      `Explain the sentence in ${lang}: first its meaning in one line, then the grammar that matters ` +
      "(word order, separable verbs, tenses) in at most 4 short bullet points. No introduction, under 120 words.",
    messages: [{ role: "user", content: sentence }],
    maxTokens: 1024,
  });
  return res.text.trim();
}

export interface SimplifyResult {
  simplified: string;
  /** Coverage of the original and of the rewrite (null when analysis was unavailable). */
  before: number | null;
  after: number | null;
  /** Unknown lemmas that remain in the rewrite. */
  unknown: string[];
}

export interface SimplifyDeps {
  provider: AIProvider;
  analyze: (text: string) => Promise<AnalyzedToken[]>;
  model: LearnerModel;
  vocabEstimate: number;
  /** The coverage the rewrite should reach (the learner's target). */
  targetCoverage: number;
}

/** Most offending words named in the prompt. */
const MAX_NAMED = 60;

/**
 * Rewrite Dutch text with simpler vocabulary, then re-score it. The original is never changed;
 * the caller shows both. One request, no retry loop (cost).
 */
export async function simplifyText(deps: SimplifyDeps, text: string): Promise<SimplifyResult> {
  let before: ReturnType<typeof coverageReport> | null = null;
  try {
    before = coverageReport(await deps.analyze(text), deps.model);
  } catch {
    /* scoring is optional */
  }
  const named = before?.unknown.slice(0, MAX_NAMED) ?? [];
  const res = await deps.provider.chat({
    system:
      `You rewrite Dutch texts for a learner who knows about ${deps.vocabEstimate} Dutch words. ` +
      `Keep the meaning, order and paragraphs. Aim for at least ${Math.round(deps.targetCoverage * 100)}% of the words being ones the learner knows: ` +
      "use common words and short sentences. Answer with the rewritten Dutch text only.",
    messages: [
      {
        role: "user",
        content: (named.length ? `Words to avoid or replace: ${named.join(", ")}\n\n` : "") + text,
      },
    ],
    maxTokens: 4096,
  });
  const simplified = res.text.trim();
  let after: ReturnType<typeof coverageReport> | null = null;
  try {
    after = coverageReport(await deps.analyze(simplified), deps.model);
  } catch {
    /* scoring is optional */
  }
  return {
    simplified,
    before: before ? before.coverage : null,
    after: after ? after.coverage : null,
    unknown: after?.unknown ?? [],
  };
}
