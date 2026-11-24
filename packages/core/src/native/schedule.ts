/**
 * The native scheduler: FSRS-6 through ts-fsrs, with learning and relearning steps, a maximum
 * interval, the deck's target retention and a random spread of due dates. The learner model
 * reads a card's memory with the same rules as an Anki card (`classifyCard`).
 */
import {
  type Card,
  type Grade,
  type LearningStepsResolver,
  Rating,
  State,
  StrategyMode,
  calculateLearningSteps,
  ConvertStepUnitToMinutes,
  createEmptyCard,
  default_w,
  fsrs,
  generatorParameters,
} from "ts-fsrs";
import { toFsrsCard } from "../fsrsCard.js";
import type { CardMemory } from "../memory.js";
import type { CardRating, CardReview, CardSchedule, DeckOptions } from "./types.js";

const DAY_MS = 86_400_000;

/** FSRS-6 default parameters (21 weights). */
export const DEFAULT_FSRS_PARAMS: readonly number[] = default_w;

/** The forgetting-curve decay of a parameter set (FSRS-6 keeps it in the last weight). */
export function paramsDecay(params: readonly number[]): number {
  return params.length >= 21 ? (params[20] ?? 0.5) : 0.5;
}

const minutes = (m: number): `${number}m` => `${Math.max(1, Math.round(m))}m`;

/**
 * The learning steps as Anki does them. ts-fsrs gives Hard the first step's value on every step
 * (halfway between the first two steps); Anki does that only on the first step and repeats the
 * current step on a later one (`rslib/src/scheduler/states/steps.rs`, `hard_delay_secs`). With
 * the default 1m and 10m, Hard on the 10-minute step waits 10 minutes, not 5.5.
 */
export const ankiLearningSteps: LearningStepsResolver = (config, state, step) => {
  const result = calculateLearningSteps(config, state, step);
  const steps = state === State.Relearning ? config.relearningSteps : config.learningSteps;
  const current = steps[step];
  const hard = result[Rating.Hard];
  if (state !== State.Review && step > 0 && current !== undefined && hard) {
    return {
      ...result,
      [Rating.Hard]: { ...hard, scheduledMinutes: ConvertStepUnitToMinutes(current) },
    };
  }
  return result;
};

function schedulerFor(options: DeckOptions, params: readonly number[], fuzz: boolean) {
  const f = fsrs(
    generatorParameters({
      w: params.length === 21 ? [...params] : [...DEFAULT_FSRS_PARAMS],
      request_retention: Math.min(0.99, Math.max(0.7, options.desiredRetention)),
      maximum_interval: Math.max(1, Math.round(options.maxInterval)),
      enable_fuzz: fuzz,
      enable_short_term: true,
      learning_steps: options.learningSteps.map(minutes),
      relearning_steps: options.relearningSteps.map(minutes),
    }),
  );
  return f.useStrategy(StrategyMode.LEARNING_STEPS, ankiLearningSteps);
}

function toCard(s: CardSchedule | undefined, now: number): Card {
  return s ? toFsrsCard(s) : createEmptyCard(new Date(now));
}

function fromCard(c: Card, now: number): CardSchedule {
  return {
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    scheduledDays: c.scheduled_days,
    learningSteps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: (c.state === 0 ? 1 : c.state) as 1 | 2 | 3,
    lastReview: c.last_review?.getTime() ?? now,
  };
}

export interface ScheduleContext {
  options: DeckOptions;
  params: readonly number[];
  /** Random spread of review intervals (on for real reviews, off for replays and tests). */
  fuzz?: boolean;
}

/** The card after one answer. `schedule` undefined is a new card. */
export function answerCard(
  schedule: CardSchedule | undefined,
  rating: CardRating,
  now: number,
  ctx: ScheduleContext,
): CardSchedule {
  const f = schedulerFor(ctx.options, ctx.params, ctx.fuzz ?? true);
  return fromCard(f.next(toCard(schedule, now), new Date(now), rating as Grade).card, now);
}

/** What each button would do now: the next schedule per rating. */
export function previewCard(
  schedule: CardSchedule | undefined,
  now: number,
  ctx: ScheduleContext,
): Record<CardRating, CardSchedule> {
  const f = schedulerFor(ctx.options, ctx.params, ctx.fuzz ?? true);
  const p = f.repeat(toCard(schedule, now), new Date(now));
  const out = {} as Record<CardRating, CardSchedule>;
  for (const r of [1, 2, 3, 4] as const) out[r] = fromCard(p[r as Grade].card, now);
  return out;
}

/** "1m", "10m", "3h", "4d", "2mo", "1.5y": the gap between now and a due time. */
export function formatInterval(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `${m}m`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)}h`;
  const d = ms / DAY_MS;
  if (d < 30.5) return `${Math.round(d)}d`;
  if (d < 365) return `${Math.round(d / 30.4)}mo`;
  const y = d / 365;
  return `${y < 10 ? Math.round(y * 10) / 10 : Math.round(y)}y`;
}

/**
 * Replay a card's review history (oldest first) to its memory state. Manual changes are not
 * answers and are skipped, except a reset (a manual entry after which the card was new again),
 * which starts the card over. Returns undefined when nothing was answered.
 */
export function replayReviews(
  reviews: readonly CardReview[],
  ctx: ScheduleContext,
): CardSchedule | undefined {
  let s: CardSchedule | undefined;
  const sorted = [...reviews].sort((a, b) => a.at - b.at);
  for (const r of sorted) {
    if (r.rating === 0) {
      if (r.kind === "manual" && s && isReset(r, sorted)) s = undefined;
      continue;
    }
    s = answerCard(s, r.rating, r.at, { ...ctx, fuzz: false });
  }
  return s;
}

/** A manual entry followed only by learning answers (or nothing) is a reset to new. */
function isReset(entry: CardReview, sorted: readonly CardReview[]): boolean {
  const next = sorted.find((r) => r.at > entry.at && r.rating !== 0);
  return next !== undefined && next.kind === "learn";
}

/**
 * A card's memory for the learner model, read like an Anki card with FSRS on: stability, the
 * time of the last answer and the parameter set's decay.
 */
export function scheduleMemory(
  schedule: CardSchedule | undefined,
  decay: number,
  suspended = false,
): CardMemory {
  if (!schedule) return { intervalDays: 0, isNew: true };
  const intervalDays =
    schedule.state === 2
      ? Math.max(0.01, schedule.scheduledDays)
      : Math.max(0.01, (schedule.due - schedule.lastReview) / DAY_MS);
  const memory: CardMemory = {
    intervalDays,
    stabilityDays: schedule.stability,
    lastReviewMs: schedule.lastReview,
    decay,
  };
  if (suspended) memory.suspended = true;
  return memory;
}

/**
 * A schedule for a card reviewed in Anki whose history is missing (for example a card whose
 * due date was set by hand): stability from its interval, middling difficulty.
 */
export function scheduleFromInterval(
  intervalDays: number,
  due: number,
  lastReview: number,
): CardSchedule {
  const days = Math.max(1, intervalDays);
  return {
    due,
    stability: days,
    difficulty: 5,
    scheduledDays: Math.round(days),
    learningSteps: 0,
    reps: 1,
    lapses: 0,
    state: 2,
    lastReview,
  };
}

/**
 * Give a card a mature interval (Mark known): due in 21–35 days, stability to match, as if it
 * had been answered Good now.
 */
export function knownSchedule(
  prev: CardSchedule | undefined,
  now: number,
  random: () => number = Math.random,
): CardSchedule {
  const days = 21 + Math.floor(random() * 15);
  return {
    due: now + days * DAY_MS,
    stability: Math.max(days, prev?.stability ?? 0),
    difficulty: prev?.difficulty ?? 5,
    scheduledDays: days,
    learningSteps: 0,
    reps: (prev?.reps ?? 0) + 1,
    lapses: prev?.lapses ?? 0,
    state: 2,
    lastReview: now,
  };
}
