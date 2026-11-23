/**
 * Segment planning: which unknown words to introduce or
 * gloss, and which known/learning words to turn into clozes.
 */
import type { LearnerModel } from "../learner.js";
import { classifyTokens, coverageOf, isCounted } from "./classify.js";
import { segmentTokens } from "./segment.js";
import type { WeightedSegmentPlan } from "./staircase.js";
import type {
  AnalyzedToken,
  PlannedToken,
  PlannerOptions,
  Segment,
  SegmentPlan,
  TokenLabel,
} from "./types.js";

/** Words with pKnown below this are "unknown" for planning. */
export const UNKNOWN_THRESHOLD = 0.5;
/** Recall range of words chosen as clozes (shakier words preferred within it). */
const CLOZE_P_RANGE = [0.6, 0.99] as const;
/** Function words make poor clozes ("met", "de", "hij"): only content words are blanked. */
const CLOZE_EXCLUDED_POS: ReadonlySet<string> = new Set([
  "ADP",
  "DET",
  "PRON",
  "CCONJ",
  "SCONJ",
  "AUX",
  "PART",
  "INTJ",
]);
const CLOZE_MIN_SENTENCE_WORDS = 6;
const CLOZE_MIN_CHARS = 2;
/** Recall assumed for an assumed-familiar word without evidence (the bottom of the cloze range). */
const ASSUMED_P_KNOWN = CLOZE_P_RANGE[0];
/** A "page": the new-word budget is per page (segments are ~150 words). */
const BUDGET_WORDS = 150;
/** Words rarer than this (Zipf < 3, about rank 20,000+) are never introduced, only glossed. */
const ABSOLUTE_MIN_ZIPF = 3.0;

/**
 * How far above the learner's vocabulary new words may come from (frequency ranks): the next
 * 3000 up to a vocabulary of 3000, then narrowing to the next 1500 (vocabulary 6000 and more),
 * closer to the "next 1,000-word level" reading research suggests (Nation 2014).
 */
export function learningWindow(vocabEstimate: number): number {
  const v = Math.max(1, vocabEstimate);
  return Math.round(Math.max(1500, Math.min(3000, 3000 - (v - 3000) / 2)));
}

/**
 * Lowest Zipf frequency worth introducing for a learner with `vocabEstimate` known words:
 * words within the next `learningWindow` frequency ranks are worth learning now. Zipf ≈ 7.6 −
 * 0.9·log10(rank) approximates Dutch wordfreq (rank 1000 → 4.9, 3000 → 4.5, 10000 → 4.0),
 * clamped to [2.5, 5.0]. Examples: vocab 300 → 4.43, 1000 → 4.36, 8000 → 4.02. Rarer words are
 * glossed, not taught.
 */
export function zipfFloor(vocabEstimate: number): number {
  const rank = Math.max(1, vocabEstimate) + learningWindow(vocabEstimate);
  const floor = 7.6 - 0.9 * Math.log10(rank);
  return Math.min(5.0, Math.max(2.5, Math.round(floor * 100) / 100));
}

/** Usefulness of learning a word: its Zipf frequency (frequent words pay off more). */
function usefulness(zipf: number): number {
  return zipf;
}

interface UnknownKey {
  key: string;
  repeats: number;
  zipf: number;
}

interface ClozePick {
  score: number;
  k: number;
  sentence: number;
}

/**
 * Label and recall a token has as a cloze candidate: its own, or, for a new word the learner is
 * assumed to know (and not being introduced on this page), "learning" at ASSUMED_P_KNOWN.
 */
function clozeView(
  p: PlannedToken,
  assumed: ReadonlySet<string> | undefined,
  introduced: ReadonlySet<string>,
): { label: PlannedToken["label"]; pKnown: number } {
  if (p.label === "new" && p.key !== null && assumed?.has(p.key) && !introduced.has(p.key))
    return { label: "learning", pKnown: Math.max(p.pKnown, ASSUMED_P_KNOWN) };
  return p;
}

/** Choose cloze token indices (`AnalyzedToken.i`) for one segment. */
function pickClozes(
  toks: readonly AnalyzedToken[],
  base: readonly PlannedToken[],
  assumed: ReadonlySet<string> | undefined,
  introduced: ReadonlySet<string>,
): number[] {
  // group token positions by sentence
  const sentences: number[][] = [];
  toks.forEach((t, k) => {
    const last = sentences[sentences.length - 1];
    if (last && toks[last[0]!]!.sent === t.sent) last.push(k);
    else sentences.push([k]);
  });
  const maxClozes = Math.floor(sentences.length / 2);
  if (maxClozes < 1) return [];

  const best: ClozePick[] = [];
  sentences.forEach((positions, si) => {
    if (si === 0) return;
    if (positions.filter((k) => toks[k]!.is_word).length < CLOZE_MIN_SENTENCE_WORDS) return;
    let top: ClozePick | undefined;
    for (const k of positions) {
      const t = toks[k]!;
      const p = clozeView(base[k]!, assumed, introduced);
      const eligible =
        (p.label === "known" || p.label === "learning") &&
        t.particle_of === null &&
        !t.is_propn &&
        !t.is_num &&
        !CLOZE_EXCLUDED_POS.has(t.pos) &&
        t.text.length >= CLOZE_MIN_CHARS &&
        p.pKnown >= CLOZE_P_RANGE[0] &&
        p.pKnown <= CLOZE_P_RANGE[1];
      if (!eligible) continue;
      // prefer learning words, then the least certain recall; earlier token wins ties
      const score = (p.label === "learning" ? 1 : 0) + (1 - p.pKnown);
      if (!top || score > top.score) top = { score, k, sentence: si };
    }
    if (top) best.push(top);
  });

  best.sort((x, y) => y.score - x.score || x.sentence - y.sentence);
  return best.slice(0, maxClozes).map((c) => toks[c.k]!.i);
}

/** Weight of a word's meetings elsewhere in the text, against its meetings on this page. */
const ELSEWHERE_WEIGHT = 0.5;

/**
 * How often each unknown key occurs in the whole text (counted tokens). A word that comes back
 * on later pages is a better word to learn: one meeting rarely teaches a word, about ten do
 * (Webb 2007; Uchihara, Webb & Yanagisawa 2019).
 */
function textRepeats(
  tokens: readonly AnalyzedToken[],
  base: readonly PlannedToken[],
): Map<string, number> {
  const n = new Map<string, number>();
  tokens.forEach((t, k) => {
    const p = base[k]!;
    if (!isCounted(t, p) || p.key === null || p.label !== "new") return;
    n.set(p.key, (n.get(p.key) ?? 0) + 1);
  });
  return n;
}

function planFromClassified(
  tokens: readonly AnalyzedToken[],
  baseAll: readonly PlannedToken[],
  segment: Segment,
  opts: PlannerOptions,
  inText?: ReadonlyMap<string, number>,
): WeightedSegmentPlan {
  const { tokenStart: a, tokenEnd: b } = segment;
  const toks = tokens.slice(a, b);
  const base = baseAll.slice(a, b);
  const planned: PlannedToken[] = base.map((p) => ({ ...p }));
  const wordCount = toks.filter((t) => t.is_word).length;

  // 1. unknown keys (counted tokens only, so particles never count twice)
  const unknown = new Map<string, UnknownKey>();
  toks.forEach((t, k) => {
    const p = base[k]!;
    // Only words not yet studied: an overdue Anki "learning" word stays "learning".
    if (!isCounted(t, p) || p.key === null || p.label !== "new" || p.pKnown >= UNKNOWN_THRESHOLD)
      return;
    const u = unknown.get(p.key);
    if (u) {
      u.repeats++;
      u.zipf = Math.max(u.zipf, t.zipf);
    } else unknown.set(p.key, { key: p.key, repeats: 1, zipf: t.zipf });
  });

  const floor = zipfFloor(opts.vocabEstimate);
  // Meetings on this page count fully, meetings on the text's other pages half.
  const meetings = (u: UnknownKey) =>
    u.repeats + ELSEWHERE_WEIGHT * Math.max(0, (inText?.get(u.key) ?? u.repeats) - u.repeats);
  const score = (u: UnknownKey) => meetings(u) * usefulness(u.zipf);
  const ranked = [...unknown.values()].sort(
    (x, y) => score(y) - score(x) || y.zipf - x.zipf || x.key.localeCompare(y.key),
  );
  // Words worth learning now come first; if the user's budget is larger than that, fill it with
  // the next most useful words, but never rare ones (below ABSOLUTE_MIN_ZIPF = jargon).
  const preferred = ranked.filter((u) => u.zipf >= floor);
  const fill = ranked.filter((u) => u.zipf < floor && u.zipf >= ABSOLUTE_MIN_ZIPF);
  const candidates = [...preferred, ...fill];
  // B words per page; a page longer than BUDGET_WORDS scales up, a shorter one gets B.
  const budget =
    candidates.length && opts.newWordBudget > 0
      ? Math.max(
          1,
          Math.round((opts.newWordBudget * Math.max(wordCount, BUDGET_WORDS)) / BUDGET_WORDS),
        )
      : 0;
  const introduce = candidates.slice(0, budget).map((u) => u.key);
  const introSet = new Set(introduce);
  const gloss = ranked.map((u) => u.key).filter((k) => !introSet.has(k));
  const glossSet = new Set(gloss);

  planned.forEach((p, k) => {
    if (!isCounted(toks[k]!, p) || p.key === null || p.label !== "new") return;
    if (introSet.has(p.key)) p.label = "introduce";
    else if (glossSet.has(p.key)) p.label = "gloss";
  });

  // 2. clozes
  const clozes = opts.clozes ? pickClozes(toks, base, opts.assumedFamiliar, introSet) : [];
  const clozeSet = new Set(clozes);
  planned.forEach((p) => {
    if (clozeSet.has(p.i)) p.label = "cloze";
  });

  // 3. detached particles mirror their verb (a cloze verb leaves its particle visible)
  toks.forEach((t, k) => {
    if (t.particle_of === null) return;
    const vk = t.particle_of - a;
    const verbPlan = vk >= 0 && vk < planned.length ? planned[vk] : undefined;
    if (!verbPlan) return;
    const label = verbPlan.label === "cloze" ? base[vk]!.label : verbPlan.label;
    planned[k] = { ...verbPlan, i: t.i, label };
  });

  return {
    segment,
    tokens: planned,
    coverage: coverageOf(base, toks),
    newTypes: ranked.map((u) => u.key),
    introduce,
    gloss,
    clozes: [...clozes].sort((x, y) => x - y),
    countedWords: toks.filter((t, k) => isCounted(t, base[k]!)).length,
  };
}

/**
 * Plan one segment: rank unknown words, pick those to introduce (budget scaled by segment
 * length: B x words / 150, at least 1 when any candidate exists), gloss the rest, and
 * choose clozes. Unknown words rarer than `zipfFloor(opts.vocabEstimate)` are never introduced.
 *
 * @param tokens all analysed tokens (segment indexes into this array)
 * @returns the plan; also carries `countedWords` (see WeightedSegmentPlan)
 */
export function planSegment(
  tokens: readonly AnalyzedToken[],
  segment: Segment,
  model: LearnerModel,
  opts: PlannerOptions,
): WeightedSegmentPlan {
  return planFromClassified(tokens, classifyTokens(tokens, model), segment, opts);
}

/** Segment the text and plan every segment (classifying tokens only once). */
export function planText(
  tokens: readonly AnalyzedToken[],
  model: LearnerModel,
  opts: PlannerOptions,
  text?: string,
): WeightedSegmentPlan[] {
  const classified = classifyTokens(tokens, model);
  const inText = textRepeats(tokens, classified);
  return segmentTokens(tokens, undefined, text).map((s) =>
    planFromClassified(tokens, classified, s, opts, inText),
  );
}

/** A word's new state after a word action while a page is open. */
export type WordChange = "known" | "learning" | "ignored";

/**
 * The page's plan after the learner changed one word: every token of `key` takes the new state
 * at once (underline, gloss and counts), while clozes stay where they are, since answers are
 * keyed by token index. Returns the same plan when the key is not on the page.
 */
export function relabelKey<P extends SegmentPlan>(plan: P, key: string, change: WordChange): P {
  if (!plan.tokens.some((t) => t.key === key)) return plan;
  const cloze = new Set(plan.clozes);
  const label: TokenLabel = change;
  const pKnown = change === "learning" ? 0.2 : 1;
  const tokens = plan.tokens.map((t) =>
    t.key === key && !cloze.has(t.i) ? { ...t, label, pKnown } : t,
  );
  const drop = (keys: string[]) => keys.filter((k) => k !== key);
  return {
    ...plan,
    tokens,
    introduce: drop(plan.introduce),
    gloss: drop(plan.gloss),
    newTypes: change === "learning" ? plan.newTypes : drop(plan.newTypes),
  };
}
