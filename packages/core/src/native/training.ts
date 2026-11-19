/**
 * Training data for the FSRS optimizer: each card's answers as (rating, days since the previous
 * answer) in study days, the way the optimizer expects them. A study day starts at 4:00 local
 * time, as in Anki.
 */
import type { CardReview } from "./types.js";

const DAY_MS = 86_400_000;
/** The study day starts this many hours after midnight. */
const DAY_STARTS_AT_HOURS = 4;

/** One card's answers, oldest first: ratings 1–4 and whole study days since the previous one. */
export interface TrainingSequence {
  ratings: number[];
  deltaDays: number[];
}

/**
 * Sequences for training. A card counts only when its history starts with a learning answer
 * (otherwise the start of its history is missing); a reset starts the sequence over. Manual
 * changes and filtered-deck answers without a rating are left out.
 *
 * @param utcOffsetMinutes the learner's offset from UTC (e.g. 60 for CET), for study days
 */
export function trainingSequences(
  reviews: readonly CardReview[],
  utcOffsetMinutes: number,
): TrainingSequence[] {
  const byCard = new Map<number, CardReview[]>();
  for (const r of reviews) {
    const list = byCard.get(r.cardId);
    if (list) list.push(r);
    else byCard.set(r.cardId, [r]);
  }
  const shift = (utcOffsetMinutes - DAY_STARTS_AT_HOURS * 60) * 60_000;
  const day = (at: number) => Math.floor((at + shift) / DAY_MS);
  const out: TrainingSequence[] = [];
  for (const list of byCard.values()) {
    list.sort((a, b) => a.at - b.at);
    let seq: CardReview[] = [];
    for (const r of list) {
      if (r.rating === 0) {
        // A reset: the following learning answers start a new history.
        if (r.kind === "manual") seq = [];
        continue;
      }
      seq.push(r);
    }
    const first = seq[0];
    if (!first || first.kind !== "learn") continue;
    const ratings: number[] = [];
    const deltaDays: number[] = [];
    let prev = day(first.at);
    for (const r of seq) {
      const d = day(r.at);
      ratings.push(r.rating);
      deltaDays.push(ratings.length === 1 ? 0 : Math.max(0, d - prev));
      prev = d;
    }
    out.push({ ratings, deltaDays });
  }
  return out;
}

/** Number of answers a set of sequences holds after the first one of each card. */
export function trainingReviewCount(seqs: readonly TrainingSequence[]): number {
  return seqs.reduce((n, s) => n + Math.max(0, s.ratings.length - 1), 0);
}
