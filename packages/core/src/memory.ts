/**
 * Memory model helpers shared by the learner model.
 *
 * FSRS retrievability: R(t) = (1 + F * t / S) ^ (-decay), where for FSRS-4.5/5
 * decay = 0.5 and F = 19/81 (so that R(S) = 0.9). FSRS-6 learns `decay` per preset;
 * in that case F = 0.9^(-1/decay) - 1.
 * See docs/research/02-anki-integration.md §6 and docs/research/03-algorithms.md §2.
 */

export const DEFAULT_DECAY = 0.5;
const DAY_MS = 86_400_000;

/** Factor F such that R(t = S) = 0.9 for the given decay. */
export function fsrsFactor(decay: number = DEFAULT_DECAY): number {
  return Math.pow(0.9, -1 / decay) - 1;
}

/** Probability of recall after `elapsedDays` for a card with stability `stabilityDays`. */
export function retrievability(
  elapsedDays: number,
  stabilityDays: number,
  decay: number = DEFAULT_DECAY,
): number {
  if (!(stabilityDays > 0)) return 0;
  const t = Math.max(0, elapsedDays);
  return Math.pow(1 + (fsrsFactor(decay) * t) / stabilityDays, -decay);
}

export type WordState = "unknown" | "seen" | "learning" | "known" | "ignored";

/** Minimal scheduling snapshot of one Anki card, platform-independent. */
export interface CardMemory {
  /** Anki interval in days (0 for new cards). */
  intervalDays: number;
  /** FSRS stability in days, if FSRS is enabled. */
  stabilityDays?: number;
  /** FSRS decay of the card's preset (FSRS-6); defaults to 0.5. */
  decay?: number;
  /** Last review time (ms since epoch), needed for FSRS retrievability. */
  lastReviewMs?: number;
  /** True for new (never reviewed) cards. */
  isNew?: boolean;
}

export interface WordKnowledge {
  state: WordState;
  /** Probability the learner currently knows the word, in [0, 1]. */
  pKnown: number;
}

/** Interval (or stability) in days from which a card counts as "known" (Anki's "mature"). */
export const KNOWN_THRESHOLD_DAYS = 21;

/**
 * Classify a card into a word state with a probability of knowing it.
 * Known: interval ≥ 21d, or FSRS S ≥ 21d with R ≥ 0.9. Learning: anything else that has been reviewed.
 */
export function classifyCard(card: CardMemory, nowMs: number = Date.now()): WordKnowledge {
  if (card.isNew || card.intervalDays <= 0) return { state: "unknown", pKnown: 0 };

  let p: number;
  if (card.stabilityDays !== undefined && card.lastReviewMs !== undefined) {
    const elapsed = (nowMs - card.lastReviewMs) / DAY_MS;
    p = retrievability(elapsed, card.stabilityDays, card.decay ?? DEFAULT_DECAY);
  } else if (card.lastReviewMs !== undefined) {
    // SM-2: the interval targets ~90% recall at the due date, so R ≈ 0.9^(elapsed / interval).
    const elapsed = Math.max(0, (nowMs - card.lastReviewMs) / DAY_MS);
    p = Math.pow(0.9, elapsed / card.intervalDays);
  } else {
    p =
      card.intervalDays >= KNOWN_THRESHOLD_DAYS
        ? 0.9
        : Math.min(0.9, card.intervalDays / KNOWN_THRESHOLD_DAYS);
  }

  const known =
    card.intervalDays >= KNOWN_THRESHOLD_DAYS ||
    (card.stabilityDays !== undefined && card.stabilityDays >= KNOWN_THRESHOLD_DAYS && p >= 0.9);

  return { state: known ? "known" : "learning", pKnown: p };
}

/** Merge knowledge of several cards for the same lemma: keep the strongest evidence. */
export function mergeKnowledge(a: WordKnowledge | undefined, b: WordKnowledge): WordKnowledge {
  if (!a) return b;
  const rank: Record<WordState, number> = {
    ignored: 4,
    known: 3,
    learning: 2,
    seen: 1,
    unknown: 0,
  };
  if (rank[b.state] !== rank[a.state]) return rank[b.state] > rank[a.state] ? b : a;
  return b.pKnown > a.pKnown ? b : a;
}
