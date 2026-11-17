import { createEmptyCard, fsrs, generatorParameters, Rating, type Card, type State } from "ts-fsrs";
import type { Grade, ItemState, Skill } from "./types.js";

const DAY_MS = 86_400_000;
const ALL_SKILLS: readonly Skill[] = ["recognition", "recall", "form", "gender", "listening"];

/** Default parameters, fuzz off so schedules are deterministic. */
const scheduler = fsrs(generatorParameters({ enable_fuzz: false }));

const RATING = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
} as const;

function toCard(s: ItemState): Card {
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

/**
 * One FSRS step. `state` undefined means the pair was never practised (new card).
 * @param now review time, ms since epoch.
 */
export function review(
  state: ItemState | undefined,
  key: string,
  skill: Skill,
  grade: Grade,
  now: number,
): ItemState {
  const card = state ? toCard(state) : createEmptyCard(new Date(now));
  const next = scheduler.next(card, new Date(now), RATING[grade]).card;
  return {
    key,
    skill,
    due: next.due.getTime(),
    stability: next.stability,
    difficulty: next.difficulty,
    elapsedDays:
      state?.lastReview !== undefined ? Math.max(0, (now - state.lastReview) / DAY_MS) : 0,
    scheduledDays: next.scheduled_days,
    reps: next.reps,
    lapses: next.lapses,
    state: next.state as 0 | 1 | 2 | 3,
    lastReview: now,
    learningSteps: next.learning_steps,
  };
}

/**
 * Summary for the practice home screen.
 * - due: pairs with due <= now
 * - learned: pairs in ts-fsrs state Review (2)
 * - bySkill: number of practised (key, skill) pairs per skill
 */
export function practiceStats(
  states: readonly ItemState[],
  now: number,
): { due: number; learned: number; bySkill: Record<Skill, number> } {
  const bySkill = Object.fromEntries(ALL_SKILLS.map((s) => [s, 0])) as Record<Skill, number>;
  let due = 0;
  let learned = 0;
  for (const s of states) {
    if (s.due <= now) due++;
    if (s.state === 2) learned++;
    bySkill[s.skill]++;
  }
  return { due, learned, bySkill };
}
