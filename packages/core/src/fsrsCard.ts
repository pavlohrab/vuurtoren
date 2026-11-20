import type { Card, State } from "ts-fsrs";

/** The ts-fsrs card fields a stored schedule keeps, dates as ms since epoch. */
interface StoredFsrs {
  due: number;
  stability: number;
  difficulty: number;
  scheduledDays: number;
  learningSteps?: number;
  reps: number;
  lapses: number;
  state: number;
  lastReview?: number;
}

/** A stored schedule as a ts-fsrs card. */
export function toFsrsCard(s: StoredFsrs): Card {
  const card: Card = {
    due: new Date(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    scheduled_days: s.scheduledDays,
    learning_steps: s.learningSteps ?? 0,
    reps: s.reps,
    lapses: s.lapses,
    state: s.state as State,
  };
  if (s.lastReview !== undefined) card.last_review = new Date(s.lastReview);
  return card;
}
