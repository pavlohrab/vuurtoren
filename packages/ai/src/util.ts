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
