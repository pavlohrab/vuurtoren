/**
 * Workload: where a review's due date lands within its random spread, lighter days of the week,
 * and how many reviews a day a target recall means.
 */
import { get_fuzz_range } from "ts-fsrs";

/**
 * How much of the usual load each weekday takes, Monday first: 1 normal, 0.5 reduced, 0 as
 * little as possible.
 */
export type WeekLoad = readonly [number, number, number, number, number, number, number];
export const NORMAL_WEEK: WeekLoad = [1, 1, 1, 1, 1, 1, 1];

/** Monday-first index (0–6) of a weekday from `Date.getDay()` (Sunday 0). */
export const mondayFirst = (jsDay: number) => (jsDay + 6) % 7;

/**
 * The interval (days) to give a review answer: within the range the random spread allows
 * (`get_fuzz_range` for `interval`), the day with the lightest load, weighed by the weekday's
 * share; ties go to the day nearest the planned interval. Intervals under 3 days are kept.
 *
 * @param dueOn reviews already due on the day `d` days from now
 * @param weekdayOf Monday-first weekday of the day `d` days from now
 */
export function balanceInterval(
  interval: number,
  elapsedDays: number,
  maxInterval: number,
  dueOn: (d: number) => number,
  weekdayOf: (d: number) => number,
  week: WeekLoad = NORMAL_WEEK,
): number {
  const planned = Math.max(1, Math.round(interval));
  if (planned < 3) return planned;
  const { min_ivl, max_ivl } = get_fuzz_range(planned, Math.max(0, elapsedDays), maxInterval);
  let best = planned;
  let bestCost = Number.POSITIVE_INFINITY;
  for (let d = min_ivl; d <= max_ivl; d++) {
    const share = week[weekdayOf(d)] ?? 1;
    // An "as little as possible" day takes a card only when every day in the range is one.
    const cost = share > 0 ? (dueOn(d) + 1) / share : 1e9 + dueOn(d);
    if (
      cost < bestCost ||
      (cost === bestCost && Math.abs(d - planned) < Math.abs(best - planned))
    ) {
      best = d;
      bestCost = cost;
    }
  }
  return best;
}

/**
 * The FSRS-6 interval (days) at which recall falls to `retention`, for a memory of
 * `stability` days and the parameter set's `decay`: R(t) = (1 + F·t/S)^(−decay), with F chosen
 * so that R(S) = 0.9.
 */
export function intervalAt(stability: number, retention: number, decay: number): number {
  const d = Math.max(0.01, decay);
  const factor = Math.pow(0.9, -1 / d) - 1;
  return (stability / factor) * (Math.pow(retention, -1 / d) - 1);
}

/**
 * About how many reviews a day a deck needs at a target recall: each reviewed card comes back
 * once per interval, and each new card a day adds about one more review a day while it is
 * young (its first answers).
 */
export function dailyLoad(
  stabilities: readonly number[],
  retention: number,
  decay: number,
  newPerDay: number,
  maxInterval: number,
): number {
  let load = 0;
  for (const s of stabilities) {
    load += 1 / Math.min(maxInterval, Math.max(1, intervalAt(s, retention, decay)));
  }
  return load + newPerDay;
}
