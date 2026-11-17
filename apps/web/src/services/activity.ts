/**
 * Home's week strip: learning events grouped by local calendar day. Pure, so live and mock
 * services share it and it is easy to test.
 */
import type { ActivityEntry } from "@app/db";

/** What happened on one local day. */
export interface ActivityDay {
  /** Local date, YYYY-MM-DD. */
  date: string;
  pages: number;
  exercises: number;
  added: number;
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
    const day: ActivityDay = { date: localDate(d.getTime()), pages: 0, exercises: 0, added: 0 };
    out.push(day);
    byDate.set(day.date, day);
  }
  for (const e of entries) {
    const day = byDate.get(localDate(e.at));
    if (!day) continue;
    if (e.kind === "page") day.pages++;
    else if (e.kind === "exercise") day.exercises++;
    else day.added++;
  }
  return out;
}

/** Days with any activity. */
export const activeDays = (days: readonly ActivityDay[]): number =>
  days.filter((d) => d.pages + d.exercises + d.added > 0).length;
