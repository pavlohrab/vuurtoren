/**
 * A lesson (docs/dev/algorithms.md 4.7): about 10 words, each once at the exercise the Elo model
 * and the guard rail choose; due items first, then need × use. A missed word comes back once at
 * the end, one step easier (`comeBack`). FSRS decides when, Elo decides how hard.
 * Deterministic for a given rng.
 */
import { generate } from "./generate.js";
import { replay, type EloAnswer, type GripStart } from "./elo.js";
import { STEP_OF, chooseExercise, missesByPoint, type GrammarPoint } from "./choose.js";
import { pickWords, type WordSignals } from "./select.js";
import type { Rng } from "./rng.js";
import type { Exercise, ExerciseKind, ItemState, WordData } from "./types.js";

const DAY_MS = 86_400_000;
/** Lesson sizes: Short, Normal, Long. */
export const LESSON_SIZES = [5, 10, 15] as const;
export const LESSON_SIZE = 10;
/** A grammar point missed this often in the last week gets more room. */
const WEAK_POINT_MISSES = 2;

const KINDS = Object.keys(STEP_OF) as ExerciseKind[];

export interface LessonInput {
  words: readonly WordData[];
  signals: readonly WordSignals[];
  states: readonly ItemState[];
  answers: readonly EloAnswer[];
  /** Number of words (default 10). */
  size?: number;
  now: number;
  /** Only these words (a lesson's source: this page, mistakes…); default all. */
  only?: ReadonlySet<string>;
}

const startOf = (s: WordSignals | undefined): GripStart => ({
  pKnown: s?.pKnown ?? 0.3,
  recentTaps: s?.recentTaps ?? 0,
  netClozes: s?.netClozes ?? 0,
});

/** Every exercise the generators can make for a word (one per kind). */
function candidates(word: WordData, pool: readonly WordData[], rng: Rng): Exercise[] {
  const out: Exercise[] = [];
  for (const kind of KINDS) {
    const ex = generate(kind, word, pool, rng);
    // Building needs the sentence's English on top (4.7.4); without it, no building.
    if (ex && !(ex.kind === "scramble" && !ex.prompt.translation)) out.push(ex);
  }
  return out;
}

/** Grammar points missed often in the last week. */
export function weakPoints(answers: readonly EloAnswer[], now: number): Set<GrammarPoint> {
  const out = new Set<GrammarPoint>();
  for (const [p, n] of missesByPoint(answers, now - 7 * DAY_MS))
    if (n >= WEAK_POINT_MISSES) out.add(p);
  return out;
}

/** Avoid the same kind twice in a row where possible (keeps the picked order otherwise). */
function spreadKinds(xs: Exercise[]): Exercise[] {
  const left = [...xs];
  const out: Exercise[] = [];
  while (left.length) {
    const prev = out[out.length - 1];
    let i = left.findIndex((e) => e.kind !== prev?.kind);
    if (i < 0) i = 0;
    out.push(left.splice(i, 1)[0]!);
  }
  return out;
}

export function buildLesson(input: LessonInput, rng: Rng): Exercise[] {
  const size = input.size ?? LESSON_SIZE;
  const byKey = new Map(input.words.map((w) => [w.key, w]));
  const signals = input.signals.filter(
    (s) => byKey.has(s.key) && (!input.only || input.only.has(s.key)),
  );
  const sig = new Map(signals.map((s) => [s.key, s]));
  const due = [
    ...new Map(
      input.states
        .filter((s) => s.due <= input.now && sig.has(s.key))
        .sort((a, b) => a.due - b.due)
        .map((s) => [s.key, s.key]),
    ).keys(),
  ];
  // Pick more than needed: a word may have no exercise that fits.
  const keys = pickWords(signals, due, size * 2, input.now);
  const starts = new Map(keys.map((k) => [k, startOf(sig.get(k))]));
  const elo = replay(input.answers, starts);
  const favour = weakPoints(input.answers, input.now);
  const out: Exercise[] = [];
  for (const key of keys) {
    if (out.length >= size) break;
    const word = byKey.get(key)!;
    const s = sig.get(key);
    const ex = chooseExercise({
      key,
      state: word.state,
      hasCard: s?.hasCard ?? false,
      start: starts.get(key)!,
      candidates: candidates(word, input.words, rng),
      elo,
      answers: input.answers,
      favour,
    });
    if (ex) out.push(ex);
  }
  return spreadKinds(out);
}

/** The exercise for a missed word at the end of the lesson: one step easier, another kind. */
export function comeBack(
  missed: Exercise,
  input: Omit<LessonInput, "size" | "only">,
  rng: Rng,
): Exercise | null {
  const word = input.words.find((w) => w.key === missed.key);
  if (!word) return null;
  const s = input.signals.find((x) => x.key === missed.key);
  const start = startOf(s);
  return chooseExercise({
    key: missed.key,
    state: word.state,
    hasCard: s?.hasCard ?? false,
    start,
    candidates: candidates(word, input.words, rng),
    elo: replay(input.answers, new Map([[missed.key, start]])),
    answers: input.answers,
    cap: STEP_OF[missed.kind] - 1,
    avoid: new Set([missed.kind]),
  });
}
