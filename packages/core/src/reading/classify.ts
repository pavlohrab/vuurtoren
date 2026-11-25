/**
 * Labelling tokens against the learner model and computing coverage.
 */
import type { LearnerModel } from "../learner.js";
import { splitVerbs, tokenKey } from "../match.js";
import type { AnalyzedToken, PlannedToken } from "./types.js";

/** Does this token take part in coverage / planning (a real word, not ignored, not a particle)? */
export function isCounted(t: AnalyzedToken, p: PlannedToken): boolean {
  return p.label !== "nonword" && p.label !== "ignored" && t.particle_of === null;
}

function classifyOne(t: AnalyzedToken, model: LearnerModel, split: boolean): PlannedToken {
  if (!t.is_word) return { i: t.i, label: "nonword", key: null, pKnown: 0 };
  const key = tokenKey(t, model, split);
  if (t.is_propn || t.is_num || t.unlisted) return { i: t.i, label: "ignored", key, pKnown: 1 };
  const k = model.get(key);
  if (!k) return { i: t.i, label: "new", key, pKnown: 0 };
  switch (k.state) {
    case "ignored":
      return { i: t.i, label: "ignored", key, pKnown: 1 };
    case "known":
      return { i: t.i, label: "known", key, pKnown: k.pKnown };
    case "learning":
      return { i: t.i, label: "learning", key, pKnown: k.pKnown };
    default: // "unknown" | "seen": not yet reliably known
      return { i: t.i, label: "new", key, pKnown: k.pKnown };
  }
}

/**
 * Label every token (same order and length as `tokens`).
 * Detached separable particles inherit the label, key and pKnown of their verb.
 */
export function classifyTokens(
  tokens: readonly AnalyzedToken[],
  model: LearnerModel,
): PlannedToken[] {
  const split = splitVerbs(tokens);
  const planned = tokens.map((t) => classifyOne(t, model, split.has(t.i)));
  tokens.forEach((t, k) => {
    if (t.particle_of === null) return;
    const verb = planned[t.particle_of];
    if (verb) planned[k] = { ...verb, i: t.i };
  });
  return planned;
}

/**
 * Σ pKnown / counted word tokens. Nonwords, ignored tokens and detached particles are not
 * counted. Returns 1 when nothing is counted. `planned` must align with `tokens`.
 */
export function coverageOf(
  planned: readonly PlannedToken[],
  tokens: readonly AnalyzedToken[],
): number {
  let sum = 0;
  let n = 0;
  planned.forEach((p, k) => {
    const t = tokens[k];
    if (!t || !isCounted(t, p)) return;
    sum += p.pKnown;
    n++;
  });
  return n ? sum / n : 1;
}
