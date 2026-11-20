/**
 * App evidence: what the learner showed inside Vuurtoren (practice exercises, reader clozes,
 * book exercises) feeding back into the learner model (docs/algorithms.md §1.7).
 *
 * Anki stays the record of known words. App evidence can only **raise** a word that Anki (or a
 * manual mark) does not already call known: it never demotes, never makes a word "known" on its
 * own, and fades when the learner stops answering. Pure: the caller passes the clock.
 */
import type { WordKnowledge } from "./memory.js";

/** Aggregated answers about one word key. Additive, so it does not depend on event order. */
export interface AppEvidence {
  /** Weighted correct answers (a hinted cloze counts {@link EVIDENCE_WEIGHT.hinted}). */
  correct: number;
  /** Wrong answers. */
  wrong: number;
  /** Time of the newest answer, ms since epoch. */
  lastAt: number;
  /** Whether the newest answer was correct (ties: wrong wins). */
  lastCorrect: boolean;
}

/** Where an answer came from. */
export type EvidenceSource = "practice" | "cloze" | "book";

/** Weight of one correct answer; a wrong answer always counts 1 wrong. */
const EVIDENCE_WEIGHT = {
  practice: 1,
  cloze: 1,
  book: 1,
  /** A cloze answered after taking a letter hint. */
  hinted: 0.5,
} as const;

/** Ceiling of the app-derived recall estimate: below "known", inside the reader's cloze range. */
export const APP_MAX_P = 0.8;
/** The app-derived estimate halves every this many days without an answer. */
const APP_HALF_LIFE_DAYS = 30;
/** Factor applied when the newest answer was wrong. */
const APP_LAST_WRONG_FACTOR = 0.5;
/** Weighted correct answers needed before a word shows as "Learning (in Vuurtoren)". */
const APP_LEARNING_MIN_CORRECT = 3;
/** ... and the current estimate must be at least this. */
const APP_LEARNING_MIN_P = 0.5;

const DAY_MS = 86_400_000;

/** The evidence one answer contributes (to be summed with {@link addEvidence}). */
export function answerEvidence(
  source: EvidenceSource,
  correct: boolean,
  at: number,
  hinted = false,
): AppEvidence {
  const weight = hinted ? EVIDENCE_WEIGHT.hinted : EVIDENCE_WEIGHT[source];
  return {
    correct: correct ? weight : 0,
    wrong: correct ? 0 : 1,
    lastAt: at,
    lastCorrect: correct,
  };
}

/** Sum two evidence records; commutative and associative, so replay order does not matter. */
export function addEvidence(a: AppEvidence | undefined, b: AppEvidence): AppEvidence {
  if (!a) return b;
  const lastCorrect =
    b.lastAt > a.lastAt
      ? b.lastCorrect
      : b.lastAt < a.lastAt
        ? a.lastCorrect
        : a.lastCorrect && b.lastCorrect;
  return {
    correct: a.correct + b.correct,
    wrong: a.wrong + b.wrong,
    lastAt: Math.max(a.lastAt, b.lastAt),
    lastCorrect,
  };
}

/**
 * Recall estimate from app answers at `nowMs`:
 * `APP_MAX_P · c / (c + w + 1) · 0.5^(days since the last answer / 30)`, halved when the newest
 * answer was wrong. One pseudo-miss keeps a single lucky answer at 0.4 at most.
 */
export function evidenceRecall(e: AppEvidence, nowMs: number): number {
  if (e.correct <= 0) return 0;
  const accuracy = e.correct / (e.correct + e.wrong + 1);
  const days = Math.max(0, (nowMs - e.lastAt) / DAY_MS);
  const fade = Math.pow(0.5, days / APP_HALF_LIFE_DAYS);
  return APP_MAX_P * accuracy * fade * (e.lastCorrect ? 1 : APP_LAST_WRONG_FACTOR);
}

/** True when the evidence is strong enough to call the word "Learning (in Vuurtoren)". */
export function isAppLearning(e: AppEvidence, nowMs: number): boolean {
  return (
    e.lastCorrect &&
    e.correct >= APP_LEARNING_MIN_CORRECT &&
    evidenceRecall(e, nowMs) >= APP_LEARNING_MIN_P
  );
}

/** Result of {@link withAppEvidence}. */
export interface EvidenceOutcome extends WordKnowledge {
  /** App evidence raised the state to "learning" ("Learning (in Vuurtoren)"). */
  appLearning: boolean;
  /** App evidence raised pKnown above the base value. */
  raised: boolean;
}

/**
 * Overlay app evidence on a word's base knowledge (Anki, pending note, or lookups).
 *
 * - `known` and `ignored` are never changed (Anki or the user decided).
 * - pKnown becomes `max(base pKnown, evidenceRecall)`.
 * - `unknown` / `seen` / no base become `learning` when {@link isAppLearning}.
 * - With no base and weaker evidence the word is `seen` (it was met in the app).
 */
export function withAppEvidence(
  base: WordKnowledge | undefined,
  e: AppEvidence,
  nowMs: number,
): EvidenceOutcome {
  if (base && (base.state === "known" || base.state === "ignored")) {
    return { ...base, appLearning: false, raised: false };
  }
  const p = evidenceRecall(e, nowMs);
  const baseP = base?.pKnown ?? 0;
  const pKnown = Math.max(baseP, p);
  const raised = pKnown > baseP;
  const strong = isAppLearning(e, nowMs);
  if (base?.state === "learning") return { state: "learning", pKnown, appLearning: false, raised };
  if (strong) return { state: "learning", pKnown, appLearning: true, raised };
  return { state: base?.state ?? "seen", pKnown, appLearning: false, raised };
}
