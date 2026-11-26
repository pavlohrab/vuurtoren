/**
 * A small Elo model for choosing exercises (docs/dev/algorithms.md 4.7.3, Pelánek 2016).
 *
 * Every answer is a match between the learner's grip on a word (θ) and how hard an exercise kind
 * is for this learner (d). The chance of a right answer is p = g + (1 − g) σ(θ − d), where g is the
 * chance of guessing (1 / choices for multiple choice, 0 otherwise). After an answer θ and d move
 * toward what happened, by a step K(n) that shrinks as the word or kind collects answers.
 *
 * Nothing here is stored: `replay` works θ and d out again from the answers in time order, so
 * every device gets the same numbers. FSRS decides when a word comes back; this decides how hard.
 * Pure: no clock, no randomness.
 */
import type { ExerciseKind } from "./types.js";

/** Starting difficulty of each kind, easy to hard (the ladder); it adapts to the learner. */
export const START_DIFFICULTY: Readonly<Record<ExerciseKind, number>> = {
  "meaning-choice": -2.0,
  "word-choice": -1.6,
  "cloze-choice": -1.2,
  gender: -1.0,
  "adjective-e": -0.8,
  separable: -0.6,
  scramble: -0.4,
  perfect: 0.4,
  "cloze-typed": 0.6,
  dictation: 0.7,
  "verb-form": 0.8,
  say: -0.2,
  "listen-build": 0.1,
  meet: -3,
  pairs: -3,
};

/** θ and d stay inside this range, so a long streak can't run away. */
const LIMIT = 4;
/** Step size: K(n) = K0 / (1 + K_DECAY · n) for something with n answers so far. */
const K0 = 0.8;
const K_DECAY = 0.1;
/** A kind's difficulty moves at this share of the word's step (kinds collect many answers). */
const KIND_SHARE = 0.5;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => Math.log(p / (1 - p));

/** The step for something that has `n` answers already. */
export const stepSize = (n: number): number => K0 / (1 + K_DECAY * n);

/** What the app knows about a word before any practice answer (4.7.1). */
export interface GripStart {
  /** Recall now from the learner model, 0..1. */
  pKnown: number;
  /** Taps on the word in the last 14 days. */
  recentTaps: number;
  /** Reader clozes right minus wrong (hinted ones count half, as in the evidence model). */
  netClozes: number;
}

/** θ before any practice answer: logit(pKnown), lower for recent taps, higher for right clozes. */
export function startGrip(s: GripStart): number {
  const base = logit(clamp(s.pKnown, 0.05, 0.95));
  return clamp(base - 0.3 * s.recentTaps + 0.3 * s.netClozes, -LIMIT, LIMIT);
}

/** Chance of a right answer for grip θ against difficulty d, with guessing chance g. */
export function chance(theta: number, d: number, guess = 0): number {
  return guess + (1 - guess) * sigmoid(theta - d);
}

/** The guessing chance of an exercise: 1 / choices for multiple choice, else 0. */
export const guessOf = (choices: number | undefined): number =>
  choices && choices > 1 ? 1 / choices : 0;

/** One practice answer, as replay needs it. */
export interface EloAnswer {
  key: string;
  kind: ExerciseKind;
  /** 1 right, 0 wrong, 0.5 right with a peek or a hint. */
  result: number;
  /** Number of choices shown (multiple choice), else undefined. */
  choices?: number;
  /** ms since epoch; replay sorts by this. */
  at: number;
}

/** θ per word and d per kind, with how many answers each has. */
export interface EloState {
  grip: Map<string, { theta: number; n: number }>;
  difficulty: Map<ExerciseKind, { d: number; n: number }>;
}

/** d of a kind now (its start when it has no answers yet). */
export function difficultyOf(state: EloState, kind: ExerciseKind): number {
  return state.difficulty.get(kind)?.d ?? START_DIFFICULTY[kind];
}

/** θ of a word now: from its answers, else from what the app knows (`start`). */
export function gripOf(state: EloState, key: string, start?: GripStart): number {
  const g = state.grip.get(key);
  if (g) return g.theta;
  return start ? startGrip(start) : 0;
}

/** Apply one answer to the state (mutates it). Returns the chance it had before. */
export function update(state: EloState, answer: EloAnswer, start?: GripStart): number {
  const word = state.grip.get(answer.key) ?? { theta: gripOf(state, answer.key, start), n: 0 };
  const kind = state.difficulty.get(answer.kind) ?? {
    d: START_DIFFICULTY[answer.kind],
    n: 0,
  };
  const p = chance(word.theta, kind.d, guessOf(answer.choices));
  const miss = clamp(answer.result, 0, 1) - p;
  state.grip.set(answer.key, {
    theta: clamp(word.theta + stepSize(word.n) * miss, -LIMIT, LIMIT),
    n: word.n + 1,
  });
  state.difficulty.set(answer.kind, {
    d: clamp(kind.d - KIND_SHARE * stepSize(kind.n) * miss, -LIMIT, LIMIT),
    n: kind.n + 1,
  });
  return p;
}

/**
 * θ and d from all answers, oldest first (ties by key, then kind, so the order is total and every
 * device agrees). `starts` gives each word's θ before its first answer.
 */
export function replay(
  answers: readonly EloAnswer[],
  starts: ReadonlyMap<string, GripStart> = new Map(),
): EloState {
  const state: EloState = { grip: new Map(), difficulty: new Map() };
  const ordered = [...answers].sort(
    (a, b) =>
      a.at - b.at ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) ||
      (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) ||
      a.result - b.result,
  );
  for (const a of ordered) update(state, a, starts.get(a.key));
  return state;
}
