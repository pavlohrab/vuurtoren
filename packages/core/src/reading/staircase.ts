/**
 * Adaptive difficulty, vocabulary estimate and difficulty bands.
 */
import type { LearnerModel } from "../learner.js";
import type { ReadingOutcome, SegmentPlan, StaircaseState } from "./types.js";

const MIN_TARGET_COVERAGE = 0.92;
const MAX_TARGET_COVERAGE = 0.99;
const MIN_BUDGET = 1;
/**
 * At most 5 new words per page of 150 (about 3% left to learn, untranslated): reading research
 * puts the minimum for understanding at about 95% of words known (Laufer & Ravenhorst-Kalovski
 * 2010) and advises keeping words left to guess well under 2–3% (Nation 2014).
 */
const MAX_BUDGET = 5;
const COVERAGE_STEP = 0.005;

/**
 * Staircase controller. Easy (accuracy >= 0.85 or no clozes, and < 2 lookups/100 words):
 * lower T by 0.005 and raise B by 1. Hard (accuracy < 0.70 or > 6 lookups/100): raise T, lower B.
 * Otherwise unchanged. Bounds: T in [0.92, 0.99], B in [1, 5] (per page); T is rounded to 3 decimals.
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
const MIN_VOCAB_ESTIMATE = 200;

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

/**
 * The new words of a text: the distinct unknown keys of all its pages, in page order. This is
 * the one definition behind a text's "N new" and the words listed for it after reading.
 */
export function textNewKeys(plans: readonly SegmentPlan[]): string[] {
  const keys = new Set<string>();
  for (const p of plans) p.newTypes.forEach((k) => keys.add(k));
  return [...keys];
}

/** Whole-text difficulty: word-weighted coverage, distinct unknown keys, and band. */
export function textDifficulty(plans: readonly SegmentPlan[]): {
  coverage: number;
  newTypes: number;
  band: DifficultyBand;
} {
  let sum = 0;
  let n = 0;
  for (const p of plans) {
    const w = weightOf(p);
    sum += p.coverage * w;
    n += w;
  }
  const coverage = n ? sum / n : 1;
  return { coverage, newTypes: textNewKeys(plans).length, band: bandOf(coverage) };
}

/** Default reader mode for a coverage value (docs/06): >= 0.95 graded, >= 0.80 glossed, else weave. */
export function defaultRenderMode(coverage: number): "graded" | "glossed" | "weave" {
  if (coverage >= 0.95) return "graded";
  if (coverage >= 0.8) return "glossed";
  return "weave";
}
