/**
 * The words of a text, the one set behind a text's "N new" (Home, Library), the reader's
 * highlights, the completion panel and Words from this text: its new words (`textNewKeys`),
 * each at its first occurrence, in text order. Live and demo services both build it here.
 */
import { type AnalyzedToken, type SegmentPlan, textNewKeys } from "@app/core";
import type { TextWordItem } from "./types.js";

export interface PickedTextWord {
  key: string;
  /** Token of the first occurrence (never a detached particle). */
  tokenIndex: number;
  source: TextWordItem["source"];
}

/**
 * Pick the text's new words. `source` says why a word stands out: highlighted to learn on a
 * page ("introduce"), else looked up while reading ("lookup"), else only translated ("gloss").
 */
export function pickTextWords(
  view: { tokens: readonly AnalyzedToken[]; plans: readonly SegmentPlan[] },
  lookedUp: ReadonlySet<string>,
): PickedTextWord[] {
  const keys = new Set(textNewKeys(view.plans));
  const picked = new Map<string, PickedTextWord>();
  for (const p of view.plans.flatMap((plan) => plan.tokens)) {
    if (!p.key || !keys.has(p.key)) continue;
    const t = view.tokens[p.i];
    // A detached particle stands for its verb, which has its own token.
    if (!t || t.particle_of !== null) continue;
    const have = picked.get(p.key);
    if (!have) {
      picked.set(p.key, {
        key: p.key,
        tokenIndex: t.i,
        source: p.label === "introduce" ? "introduce" : lookedUp.has(p.key) ? "lookup" : "gloss",
      });
    } else if (p.label === "introduce") have.source = "introduce";
  }
  return [...picked.values()];
}
