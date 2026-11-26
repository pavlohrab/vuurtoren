import type { Usage } from "./types.js";

/** A trimmed string, or "" for anything that is not a string. */
export const asString = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Number of words: letter runs, with inner apostrophes and hyphens kept in one word. */
export const wordCount = (s: string): number => s.match(/\p{L}+(?:['’-]\p{L}+)*/gu)?.length ?? 0;

/** Sum two token counts; `b` may be missing when the provider reported none. */
export function addUsage(a: Usage, b: Usage | undefined): Usage {
  if (!b) return a;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cachedTokens: (a.cachedTokens ?? 0) + (b.cachedTokens ?? 0),
  };
}

/**
 * How the model writes what the learner reads in English (OB7): the app's own plain voice, so an
 * answer from the AI sounds like the rest of the app.
 */
export const PLAIN_VOICE =
  "Write like a patient person talking: plain everyday words and short sentences that connect " +
  "with and, so or because. No introduction and no closing line. No dashes for effect, no lists of " +
  "three for rhythm, no praise words like great or perfect, no hype.";
