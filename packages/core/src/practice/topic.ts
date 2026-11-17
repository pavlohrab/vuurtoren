/**
 * Topic exercises (M5): a short session for one grammar topic, built with the ordinary M4
 * generators but only from sentences in which the topic's detector fired.
 *
 * - Sentence kinds (scramble) take every hit sentence as its own item.
 * - Word kinds (separable, perfect, gender, adjective-e, verb-form) take the words of the hits
 *   (chosen by the caller); their example sentences are narrowed to hit sentences, so a
 *   separable-verb exercise is always built on a sentence where the verb really splits.
 */
import { generate } from "./generate.js";
import { shuffle, type Rng } from "./rng.js";
import type { Exercise, ExampleSentence, ExerciseKind, WordData } from "./types.js";

/** A sentence in which the topic was detected. */
export interface TopicSentence {
  text: string;
  translation?: string;
  /** [start, end) spans of the construction's words in `text` (UTF-16); at least one. */
  marks: [number, number][];
  /** The detector's note, shown after answering. */
  note?: string;
  source: "text" | "ai" | "tatoeba";
  /** Practice key the answer is scheduled under (normally the lemma of the first marked word). */
  key: string;
}

export interface TopicSessionInput {
  /** Exercise kinds of the topic page (`practice:` in its front matter). */
  kinds: readonly ExerciseKind[];
  sentences: readonly TopicSentence[];
  /** Words of the hits, for the word kinds; also the distractor pool. */
  words: readonly WordData[];
  /** Number of exercises (default 10). */
  size?: number;
}

/** Kinds built from a sentence alone (no word data needed). */
const SENTENCE_KINDS: ReadonlySet<ExerciseKind> = new Set<ExerciseKind>(["scramble"]);

/** Same sentence? Whitespace and case do not count. */
const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** Keep only the example sentences that are hit sentences of the topic. */
export function sentencesWithHits(
  sentences: readonly ExampleSentence[],
  hits: Iterable<string>,
): ExampleSentence[] {
  const wanted = new Set([...hits].map(norm));
  return sentences.filter((s) => wanted.has(norm(s.text)));
}

/** A one-sentence pseudo-word so the scramble generator can work on a topic sentence. */
function sentenceItem(s: TopicSentence): WordData {
  const [start, end] = s.marks[0] ?? [0, 0];
  const example: ExampleSentence = { text: s.text, target: [start, end], source: s.source };
  if (s.translation) example.translation = s.translation;
  return {
    key: s.key,
    lemma: s.key,
    pos: "X",
    glosses: [],
    zipf: 0,
    state: "learning",
    pKnown: 0,
    sentences: [example],
  };
}

/**
 * Build a topic session: exercises of the topic's kinds, word and sentence exercises
 * interleaved, at most one per (kind, key) and one per sentence. Empty when nothing fits.
 */
export function buildTopicSession(input: TopicSessionInput, rng: Rng): Exercise[] {
  const size = Math.max(1, input.size ?? 10);
  const hitTexts = input.sentences.map((s) => s.text);
  const wordKinds = input.kinds.filter((k) => !SENTENCE_KINDS.has(k));
  const sentenceKinds = input.kinds.filter((k) => SENTENCE_KINDS.has(k));

  const fromWords: Exercise[] = [];
  const pool = [...input.words];
  for (const w of shuffle(input.words, rng)) {
    const narrowed: WordData = { ...w, sentences: sentencesWithHits(w.sentences, hitTexts) };
    for (const kind of shuffle(wordKinds, rng)) {
      const ex = generate(kind, narrowed, pool, rng);
      if (ex) fromWords.push(ex);
    }
  }

  const fromSentences: Exercise[] = [];
  for (const s of shuffle(input.sentences, rng)) {
    for (const kind of sentenceKinds) {
      const ex = generate(kind, sentenceItem(s), pool, rng);
      if (!ex) continue;
      if (s.note && !ex.explanation) ex.explanation = s.note;
      fromSentences.push(ex);
    }
  }

  // Interleave the two streams, skipping repeats of a (kind, key) pair or of a sentence.
  const out: Exercise[] = [];
  const seen = new Set<string>();
  const a = [...fromWords];
  const b = [...fromSentences];
  while (out.length < size && (a.length || b.length)) {
    for (const src of [a, b]) {
      const ex = src.shift();
      if (!ex || out.length >= size) continue;
      const id = `${ex.kind}\u0000${ex.key}`;
      const text = ex.answer && ex.kind === "scramble" ? `s\u0000${norm(ex.answer)}` : null;
      if (seen.has(id) && ex.kind !== "scramble") continue;
      if (text && seen.has(text)) continue;
      seen.add(id);
      if (text) seen.add(text);
      out.push(ex);
    }
  }
  return out;
}
