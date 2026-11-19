/**
 * A word's review history for the inspector: each answer with the interval it gave.
 */
import type { InspectorReview } from "../inspector.js";
import { answerCard, formatInterval } from "./schedule.js";
import type { CardReview, CardSchedule, DeckOptions } from "./types.js";

/** One card's answers, its current schedule and its deck options. */
export interface CardHistory {
  reviews: readonly CardReview[];
  schedule?: CardSchedule | undefined;
  options: DeckOptions;
}

/**
 * The latest `limit` answers over a word's cards, newest first. Each answer's interval comes
 * from replaying the card's history; the last answer of a card shows the due date it really
 * got. Manual changes are not answers and are left out.
 */
export function reviewHistory(
  cards: readonly CardHistory[],
  params: readonly number[],
  limit = 8,
): InspectorReview[] {
  const out: InspectorReview[] = [];
  for (const card of cards) {
    const answers = [...card.reviews].sort((a, b) => a.at - b.at);
    const last = answers.filter((r) => r.rating !== 0).at(-1);
    let s: CardSchedule | undefined;
    for (const r of answers) {
      if (r.rating === 0) continue;
      s = answerCard(s, r.rating, r.at, { options: card.options, params, fuzz: false });
      const due = r === last && card.schedule ? card.schedule.due : s.due;
      out.push({ at: r.at, rating: r.rating, interval: formatInterval(due - r.at) });
    }
  }
  return out.sort((a, b) => b.at - a.at).slice(0, limit);
}
