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
  /** The language server can hear speech: "say" exercises may come in. */
  speaking?: boolean;
  /** The reader's target share of known words (the staircase, 3.6); default 0.95. */
  coverage?: number;
  /** Only these words (a lesson's source: this page, mistakes…); default all. */
  only?: ReadonlySet<string>;
}

const startOf = (s: WordSignals | undefined): GripStart => ({
  pKnown: s?.pKnown ?? 0.3,
  recentTaps: s?.recentTaps ?? 0,
  netClozes: s?.netClozes ?? 0,
});

/** Building uses 4–7 words; filling a gap up to 12 (4.7.4). */
const BUILD_MAX_WORDS = 7;
const GAP_MAX_WORDS = 12;
/** Other unknown words allowed: none when building, one when filling a gap. */
const BUILD_MAX_UNKNOWN = 0;
const GAP_MAX_UNKNOWN = 1;

const words = (t: string) => t.split(/\s+/).filter(Boolean).length;

/** The word with only the sentences an exercise kind may use (the sentence guard rail). */
function forKind(word: WordData, kind: ExerciseKind, coverage = 0.95): WordData {
  const build =
    kind === "scramble" || kind === "dictation" || kind === "say" || kind === "listen-build";
  const max = build ? BUILD_MAX_WORDS : GAP_MAX_WORDS;
  const unknown = build ? BUILD_MAX_UNKNOWN : GAP_MAX_UNKNOWN;
  // Not above your reading level: the unknown share stays within what the reader allows.
  const fits = (x: { text: string; unknown?: number }) => {
    const n = words(x.text);
    const u = x.unknown ?? 0;
    return n <= max && u <= unknown && (u === 0 || u / n <= 1 - coverage);
  };
  return { ...word, sentences: word.sentences.filter(fits) };
}

/** Every exercise the generators can make for a word (one per kind). */
function candidates(
  word: WordData,
  pool: readonly WordData[],
  rng: Rng,
  speaking = false,
  coverage?: number,
): Exercise[] {
  const out: Exercise[] = [];
  for (const kind of KINDS) {
    if (kind === "say" && !speaking) continue;
    const ex = generate(kind, forKind(word, kind, coverage), pool, rng);
    // Building needs the sentence's English on top (4.7.4); without it, no building.
    if (ex && !((ex.kind === "scramble" || ex.kind === "listen-build") && !ex.prompt.translation))
      out.push(ex);
  }
  return out;
}

/**
 * One tile that doesn't belong, so building isn't only a puzzle (4.7.4): the other article,
 * else another form of a word in the sentence (loopt → loop, groot → grote).
 */
export function extraTile(pieces: readonly string[]): string | null {
  const has = new Set(pieces.map((p) => p.toLowerCase()));
  if (has.has("de") && !has.has("het")) return "het";
  if (has.has("het") && !has.has("de")) return "de";
  const verb = pieces.find((p) => /^\p{Ll}{3,}t$/u.test(p));
  if (verb && !has.has(verb.slice(0, -1))) return verb.slice(0, -1);
  const other = pieces.find((p) => /^\p{Ll}{3,}[^e]$/u.test(p) && !has.has(`${p}e`));
  return other ? `${other}e` : null;
}

/** Building gets its extra tile, at a stable place among the others. */
function withExtraTile(ex: Exercise): Exercise {
  if ((ex.kind !== "scramble" && ex.kind !== "listen-build") || !ex.pieces) return ex;
  const tile = extraTile(ex.pieces);
  if (!tile) return ex;
  const at = (ex.answer.length + tile.length) % (ex.pieces.length + 1);
  return { ...ex, pieces: [...ex.pieces.slice(0, at), tile, ...ex.pieces.slice(at)] };
}

/** The grammar page behind a kind, for the link after a miss (4.7.6). */
const TOPIC_OF: Partial<Record<ExerciseKind, string>> = {
  gender: "de-het",
  "adjective-e": "adjective-inflection",
  perfect: "perfect-tense",
  separable: "separable-verbs",
  scramble: "word-order-v2",
};

/** The grammar page and, where the generator gave none, the reason line. */
function withTopic(ex: Exercise): Exercise {
  const topic =
    ex.kind === "verb-form"
      ? /past/i.test(ex.instruction + ex.prompt.text)
        ? "imperfect-tense"
        : "present-tense"
      : TOPIC_OF[ex.kind];
  if (!topic) return ex;
  const why =
    ex.explanation ??
    (ex.kind === "scramble" ? "In a main clause the verb comes second." : undefined);
  return { ...ex, topic, ...(why ? { explanation: why } : {}) };
}

/** The text of the sentence an exercise uses, if any. */
const usedSentence = (ex: Exercise): string | undefined =>
  ex.prompt.sentence ??
  (ex.kind === "scramble" ||
  ex.kind === "listen-build" ||
  (ex.kind === "dictation" && ex.answer.includes(" "))
    ? ex.answer
    : undefined);

/** "Where you met it": the word's first sentence, when the exercise used another one (4.7.4). */
function withMetIn(ex: Exercise, word: WordData): Exercise {
  const first = word.sentences.find((x) => x.source === "anki" || x.source === "text");
  if (!first || usedSentence(ex) === first.text) return ex;
  return {
    ...ex,
    metIn: { text: first.text, ...(first.translation ? { translation: first.translation } : {}) },
  };
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

/** Not graded and not recorded: "meet" and "pairs" (4.7.7). */
export const UNGRADED: ReadonlySet<ExerciseKind> = new Set(["meet", "pairs"]);

/** A new word shown first: its sound, meaning and the sentence where you met it. */
function meetCard(word: WordData): Exercise | null {
  const meaning = word.glosses[0];
  if (!meaning) return null;
  const s = word.sentences.find((x) => x.translation) ?? word.sentences[0];
  const shown = word.article ? `${word.article} ${word.lemma}` : word.lemma;
  return {
    id: `meet-${word.key}`,
    kind: "meet",
    skill: "recognition",
    key: word.key,
    instruction: "New word",
    prompt: {
      text: shown,
      speak: shown,
      hint: meaning,
      ...(s ? { sentence: s.text } : {}),
      ...(s?.translation ? { translation: s.translation } : {}),
    },
    answer: shown,
  };
}

/** Match pairs for three to five words picked at step 1 (a warm-up, 4.7.7). */
function pairsCard(words: readonly WordData[], rng: Rng): Exercise | null {
  const pairs = words
    .filter((w) => w.glosses[0])
    .slice(0, 5)
    .map((w) => ({ nl: w.article ? `${w.article} ${w.lemma}` : w.lemma, en: w.glosses[0]! }));
  if (pairs.length < 3 || new Set(pairs.map((p) => p.en)).size < pairs.length) return null;
  return {
    id: `pairs-${Math.floor(rng() * 1e9)}`,
    kind: "pairs",
    skill: "recognition",
    key: words[0]!.key,
    instruction: "Tap the pairs",
    prompt: { text: "" },
    pairs,
    answer: "",
  };
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
      candidates: candidates(word, input.words, rng, input.speaking, input.coverage),
      elo,
      answers: input.answers,
      favour,
    });
    if (ex) out.push(withTopic(withExtraTile(withMetIn(ex, word))));
  }
  const lesson = spreadKinds(out);
  // Words never practised and without a card are shown first ("meet it"); three or more words
  // at step 1 get a match-pairs warm-up before the exercises.
  const practised = new Set(input.answers.map((a) => a.key));
  const meets = lesson
    .filter((ex) => !sig.get(ex.key)?.hasCard && !practised.has(ex.key))
    .flatMap((ex) => meetCard(byKey.get(ex.key)!) ?? []);
  const firstStep = lesson.filter((ex) => STEP_OF[ex.kind] === 1).map((ex) => byKey.get(ex.key)!);
  const warmUp = firstStep.length >= 3 ? pairsCard(firstStep, rng) : null;
  return [...meets, ...(warmUp ? [warmUp] : []), ...lesson];
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
  const ex = chooseExercise({
    key: missed.key,
    state: word.state,
    hasCard: s?.hasCard ?? false,
    start,
    candidates: candidates(word, input.words, rng, input.speaking, input.coverage),
    elo: replay(input.answers, new Map([[missed.key, start]])),
    answers: input.answers,
    cap: STEP_OF[missed.kind] - 1,
    avoid: new Set([missed.kind]),
  });
  return ex ? withTopic(withExtraTile(withMetIn(ex, word))) : null;
}
