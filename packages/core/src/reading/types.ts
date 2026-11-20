/**
 * Contracts for graded reading. Implemented in packages/core/src/reading/*.ts,
 * rendered by packages/ui (Reader, WordInspector), persisted by packages/db.
 *
 */
import type { TokenLike } from "../match.js";

/** One token from server/nlp /analyze/text (mirrors vuurtoren_nlp.models.Token). */
export interface AnalyzedToken extends TokenLike {
  i: number;
  text: string;
  lemma: string;
  alt_lemmas: string[];
  pos: string;
  morph: string;
  dep: string;
  head: number;
  sent: number;
  /** Character offsets into the analysed text. */
  start: number;
  end: number;
  is_word: boolean;
  is_propn: boolean;
  is_num: boolean;
  /** For a detached separable particle ("op" in "Ik bel je op"): index of its verb. */
  particle_of: number | null;
  /** wordfreq Zipf frequency of the lemma: ~7 very common, ~1 rare, 0 unknown. */
  zipf: number;
}

/**
 * How the reader shows a token.
 * - known / learning / new: plain learner state (learning fades with recall)
 * - introduce: unknown word chosen for this text (pre-taught, glossed on first use, offered to Anki)
 * - gloss: unknown rare word, glossed inline, never pushed to Anki
 * - cloze: known/learning word hidden for active recall
 * - ignored: proper noun, number, or user-ignored word (never counted)
 * - nonword: punctuation, whitespace, symbols
 */
export type TokenLabel =
  "known" | "learning" | "new" | "introduce" | "gloss" | "cloze" | "ignored" | "nonword";

export interface PlannedToken {
  i: number;
  label: TokenLabel;
  /** Learner-model key this token matched, else its normalised lemma; null for nonwords. */
  key: string | null;
  /** Probability the learner knows the word (0 for unknown, 1 for ignored). */
  pKnown: number;
}

/** A reading unit of ~150 word tokens, aligned to sentence boundaries. */
export interface Segment {
  index: number;
  /** Token index range [tokenStart, tokenEnd). */
  tokenStart: number;
  tokenEnd: number;
  /** Character range [charStart, charEnd) in the source text. */
  charStart: number;
  charEnd: number;
}

export interface SegmentPlan {
  segment: Segment;
  tokens: PlannedToken[];
  /** Σ p_known / counted word tokens (ignored and nonwords excluded), in [0, 1]. */
  coverage: number;
  /** Distinct keys with p_known < 0.5. */
  newTypes: string[];
  /** Keys chosen to introduce (≤ budget), most useful first. */
  introduce: string[];
  /** Keys glossed inline (unknown, not introduced). */
  gloss: string[];
  /** Token indices hidden as clozes. */
  clozes: number[];
}

export interface PlannerOptions {
  /** Target coverage T (start 0.98, floor 0.92). */
  targetCoverage: number;
  /** New words introduced per page of ~150 words (start 3; 0 = none). */
  newWordBudget: number;
  /** Estimated vocabulary size (word families); bounds which unknown words are worth introducing. */
  vocabEstimate: number;
  /** Hide known/learning words as clozes. */
  clozes: boolean;
}

/** Adaptive difficulty (staircase controller). */
export interface StaircaseState {
  targetCoverage: number;
  newWordBudget: number;
}

export interface ReadingOutcome {
  /** Share of clozes answered correctly, in [0, 1]; null if there were none. */
  clozeAccuracy: number | null;
  /** Word lookups per 100 word tokens read. */
  lookupsPer100: number;
}

/** A Dutch word group and the English words it became (side-by-side reader). */
export interface WordPair {
  /** Dutch token indices (`AnalyzedToken.i`); both parts of a split separable verb share one. */
  nl: number[];
  /** Indices into `SentencePairs.englishTokens`. */
  en: number[];
  /** 0-1, from the translation model's attention. */
  confidence: number;
}

/** One sentence's English translation and its word pairs. */
export interface SentencePairs {
  /** Sentence number (`AnalyzedToken.sent`). */
  sent: number;
  /** English; "" when there is none (no translation model, or the translation was rejected). */
  english: string;
  /** Words and punctuation of `english`, with their [start, end) in it. */
  englishTokens: { start: number; end: number; text: string }[];
  pairs: WordPair[];
  /**
   * Where the English came from: the offline model, the learner's AI provider, or the
   * translation that ships with a bundled story.
   */
  source: "offline" | "ai" | "story";
}

export const DEFAULT_PLANNER: PlannerOptions = {
  targetCoverage: 0.98,
  newWordBudget: 3,
  vocabEstimate: 1000,
  clozes: true,
};
