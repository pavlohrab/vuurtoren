/**
 * Segment planning (docs/research/03-algorithms.md §3): which unknown words to introduce or
 * gloss, and which known/learning words to turn into clozes.
 */
import type { LearnerModel } from "../learner.js";
import { classifyTokens, coverageOf, isCounted } from "./classify.js";
import { segmentTokens } from "./segment.js";
import type { WeightedSegmentPlan } from "./staircase.js";
import type { AnalyzedToken, PlannedToken, PlannerOptions, Segment } from "./types.js";

/** Words with pKnown below this are "unknown" for planning. */
export const UNKNOWN_THRESHOLD = 0.5;
/** Cloze candidates must have pKnown within this range. */
/** Recall range of words chosen as clozes (shakier words preferred within it). */
export const CLOZE_P_RANGE = [0.6, 0.99] as const;
/** Function words make poor clozes ("met", "de", "hij"): only content words are blanked. */
export const CLOZE_EXCLUDED_POS: ReadonlySet<string> = new Set([
  "ADP",
  "DET",
  "PRON",
  "CCONJ",
  "SCONJ",
  "AUX",
  "PART",
  "INTJ",
]);
export const CLOZE_MIN_SENTENCE_WORDS = 6;
export const CLOZE_MIN_CHARS = 2;
/** A "page": the new-word budget is per page (segments are ~150 words). */
export const BUDGET_WORDS = 150;
/** Words rarer than this (Zipf < 3, about rank 20,000+) are never introduced, only glossed. */
export const ABSOLUTE_MIN_ZIPF = 3.0;

/**
 * Lowest Zipf frequency worth introducing for a learner with `vocabEstimate` known words:
 * words within roughly the next 3000 frequency ranks are worth learning now (docs/research
 * 03 §3: rank <= vocab + 3000). Zipf ≈ 7.6 − 0.9·log10(rank) approximates Dutch wordfreq
 * (rank 1000 → 4.9, 3000 → 4.5, 10000 → 4.0), clamped to [2.5, 5.0].
 * Examples: vocab 300 → 4.43, 1000 → 4.36, 8000 → 3.96. Rarer words are glossed, not taught.
 */
export function zipfFloor(vocabEstimate: number): number {
  const rank = Math.max(1, vocabEstimate) + 3000;
  const floor = 7.6 - 0.9 * Math.log10(rank);
  return Math.min(5.0, Math.max(2.5, Math.round(floor * 100) / 100));
}

/** Usefulness of learning a word: its Zipf frequency (frequent words pay off more). */
export function usefulness(zipf: number): number {
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

/** Choose cloze token indices (`AnalyzedToken.i`) for one segment. */
function pickClozes(toks: readonly AnalyzedToken[], base: readonly PlannedToken[]): number[] {
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
      const p = base[k]!;
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

function planFromClassified(
  tokens: readonly AnalyzedToken[],
  baseAll: readonly PlannedToken[],
  segment: Segment,
  opts: PlannerOptions,
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
  const score = (u: UnknownKey) => u.repeats * usefulness(u.zipf);
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
  const clozes = opts.clozes ? pickClozes(toks, base) : [];
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
 * length: B x words / 300, at least 1 when any candidate exists), gloss the rest, and
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
  return segmentTokens(tokens, undefined, text).map((s) =>
    planFromClassified(tokens, classified, s, opts),
  );
}
