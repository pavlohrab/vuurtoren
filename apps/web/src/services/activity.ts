/**
 * Learning activity over time: events grouped by local calendar day (Home's week strip), by
 * week (Progress) and known words by week. Pure, so live and mock services share it and it is
 * easy to test.
 */
import type { ActivityEntry } from "@app/db";

/** What happened on one local day. */
export interface ActivityDay {
  /** Local date, YYYY-MM-DD. */
  date: string;
  pages: number;
  exercises: number;
  added: number;
  /** Native cards reviewed in Vuurtoren. */
  reviews: number;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** Local calendar date of a timestamp, YYYY-MM-DD. */
export const localDate = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Start (ms) of the local day `days - 1` days before `now`'s day. */
export function activitySince(now: number, days: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return d.getTime();
}

/** The last `days` local days, oldest first, with their counts (days without events are zero). */
export function groupActivity(
  entries: readonly ActivityEntry[],
  now: number,
  days = 7,
): ActivityDay[] {
  const out: ActivityDay[] = [];
  const byDate = new Map<string, ActivityDay>();
  const start = new Date(activitySince(now, days));
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const day: ActivityDay = {
      date: localDate(d.getTime()),
      pages: 0,
      exercises: 0,
      added: 0,
      reviews: 0,
    };
    out.push(day);
    byDate.set(day.date, day);
  }
  for (const e of entries) {
    const day = byDate.get(localDate(e.at));
    if (!day) continue;
    if (e.kind === "page") day.pages++;
    else if (e.kind === "exercise") day.exercises++;
    else if (e.kind === "review") day.reviews++;
    else day.added++;
  }
  return out;
}

/** Days with any activity. */
export const activeDays = (days: readonly ActivityDay[]): number =>
  days.filter((d) => d.pages + d.exercises + d.added + d.reviews > 0).length;

/** One week of activity (Progress, reading per week). */
export interface ActivityWeek {
  /** Local date of the week's first day, YYYY-MM-DD. */
  start: string;
  pages: number;
  exercises: number;
  added: number;
  reviews: number;
}

/** Consecutive 7-day weeks of `days` (oldest first, the last week ends today). */
export function groupWeeks(days: readonly ActivityDay[]): ActivityWeek[] {
  const out: ActivityWeek[] = [];
  const offset = days.length % 7;
  for (let i = offset; i < days.length; i += 7) {
    const week = days.slice(i, i + 7);
    out.push({
      start: week[0]!.date,
      pages: week.reduce((n, d) => n + d.pages, 0),
      exercises: week.reduce((n, d) => n + d.exercises, 0),
      added: week.reduce((n, d) => n + d.added, 0),
      reviews: week.reduce((n, d) => n + d.reviews, 0),
    });
  }
  return out;
}

/** Known words at the end of a week. */
export interface KnownPoint {
  /** Local date of the week's last day, YYYY-MM-DD. */
  date: string;
  known: number;
}

const EARLIEST_CARD = Date.UTC(2006, 0, 1);

/**
 * Known words at the end of each of the last `weeks` weeks (oldest first, the last point is
 * today). Each known word is dated by when its first card was made (Anki and Vuurtoren note ids
 * are creation times in ms); words without a usable date count from the start.
 */
export function knownByWeek(
  firstCards: readonly (number | null)[],
  now: number,
  weeks = 12,
): KnownPoint[] {
  const dated = firstCards
    .filter((t): t is number => t !== null && t >= EARLIEST_CARD && t <= now)
    .sort((a, b) => a - b);
  const undated = firstCards.length - dated.length;
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const out: KnownPoint[] = [];
  let j = 0;
  for (let w = weeks - 1; w >= 0; w--) {
    const d = new Date(end);
    d.setDate(end.getDate() - 7 * w);
    const t = d.getTime();
    while (j < dated.length && dated[j]! <= t) j++;
    out.push({ date: localDate(t), known: undated + j });
  }
  return out;
}

/** The first card of a word, from its note ids (null without one). */
export const firstCard = (noteIds: readonly number[]): number | null =>
  noteIds.length ? Math.min(...noteIds) : null;

/**
 * Days in a row with any activity, up to today: today counts once something happened today,
 * and a streak that reached yesterday is still going while today is empty.
 */
export function streak(days: readonly ActivityDay[]): number {
  const active = (d: ActivityDay) => d.pages + d.exercises + d.added + d.reviews > 0;
  let i = days.length - 1;
  if (i >= 0 && !active(days[i]!)) i--;
  let n = 0;
  for (; i >= 0 && active(days[i]!); i--) n++;
  return n;
}
