/**
 * Adaptive difficulty, vocabulary estimate and difficulty bands.
 */
import type { LearnerModel } from "../learner.js";
import type { ReadingOutcome, SegmentPlan, StaircaseState } from "./types.js";

export const MIN_TARGET_COVERAGE = 0.92;
export const MAX_TARGET_COVERAGE = 0.99;
export const MIN_BUDGET = 1;
export const MAX_BUDGET = 8;
const COVERAGE_STEP = 0.005;

/**
 * Staircase controller. Easy (accuracy >= 0.85 or no clozes, and < 2 lookups/100 words):
 * lower T by 0.005 and raise B by 1. Hard (accuracy < 0.70 or > 6 lookups/100): raise T, lower B.
 * Otherwise unchanged. Bounds: T in [0.92, 0.99], B in [1, 8] (per page); T is rounded to 3 decimals.
 */
export function updateStaircase(state: StaircaseState, outcome: ReadingOutcome): StaircaseState {
  const { clozeAccuracy: acc, lookupsPer100: lookups } = outcome;
  const round3 = (x: number) => Math.round(x * 1000) / 1000;
  const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
  let dir = 0;
  if ((acc !== null && acc < 0.7) || lookups > 6) dir = 1;
  else if ((acc === null || acc >= 0.85) && lookups < 2) dir = -1;
  return {
    targetCoverage: round3(
      clamp(state.targetCoverage + dir * COVERAGE_STEP, MIN_TARGET_COVERAGE, MAX_TARGET_COVERAGE),
    ),
    newWordBudget: clamp(state.newWordBudget - dir, MIN_BUDGET, MAX_BUDGET),
  };
}

/** Minimum vocabulary estimate, so brand-new learners still get sensible planning. */
export const MIN_VOCAB_ESTIMATE = 200;

/** Vocabulary estimate: Σ pKnown over known and learning entries, at least 200. */
export function estimateVocabulary(model: LearnerModel): number {
  let sum = 0;
  for (const k of model.values()) {
    if (k.state === "known" || k.state === "learning") sum += k.pKnown;
  }
  return Math.max(MIN_VOCAB_ESTIMATE, Math.round(sum));
}

export type DifficultyBand = "comfortable" | "stretch" | "challenging" | "weave";

/** A SegmentPlan that also records how many words counted towards its coverage. */
export interface WeightedSegmentPlan extends SegmentPlan {
  countedWords: number;
}

function weightOf(plan: SegmentPlan): number {
  if ("countedWords" in plan) return (plan as WeightedSegmentPlan).countedWords;
  return plan.tokens.filter((t) => t.label !== "nonword" && t.label !== "ignored").length;
}

/** Band for a coverage value: >= 0.98 comfortable, >= 0.95 stretch, >= 0.90 challenging, else weave. */
export function bandOf(coverage: number): DifficultyBand {
  if (coverage >= 0.98) return "comfortable";
  if (coverage >= 0.95) return "stretch";
  if (coverage >= 0.9) return "challenging";
  return "weave";
}

/** Whole-text difficulty: word-weighted coverage, distinct unknown keys, and band. */
export function textDifficulty(plans: readonly SegmentPlan[]): {
  coverage: number;
  newTypes: number;
  band: DifficultyBand;
} {
  let sum = 0;
  let n = 0;
  const types = new Set<string>();
  for (const p of plans) {
    const w = weightOf(p);
    sum += p.coverage * w;
    n += w;
    p.newTypes.forEach((k) => types.add(k));
  }
  const coverage = n ? sum / n : 1;
  return { coverage, newTypes: types.size, band: bandOf(coverage) };
}

/** Default reader mode for a coverage value (docs/06): >= 0.95 graded, >= 0.80 glossed, else weave. */
export function defaultRenderMode(coverage: number): "graded" | "glossed" | "weave" {
  if (coverage >= 0.95) return "graded";
  if (coverage >= 0.8) return "glossed";
  return "weave";
}
