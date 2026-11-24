/**
 * Asking for support, quietly. The Support button lives in the menu all the time; the card on
 * the Read home shows up only after the learner has used the app on 10 different days, then
 * again after every 60 more days of use, and never again after "Don't ask again". Counted on
 * this device only: nothing is synced or sent anywhere.
 */
import { readLocalJSON, writeLocalJSON } from "./storage/local.js";

/**
 * Where Support goes: "Why I made it" on the website, which has the bunq.me and Ko-fi
 * links. Not those links themselves: Google Play does not allow an app to link to another way
 * of paying.
 */
export const SUPPORT_URL = "https://vuurtoren.app/#why";

/** Days of use before the first ask, and between asks. */
export const FIRST_ASK_DAYS = 10;
export const ASK_AGAIN_DAYS = 60;

const KEY = "vuurtoren-support";

export type SupportState = {
  /** Different days on which the app was used. */
  days: number;
  /** The last day counted (YYYY-MM-DD, local time). */
  lastDay: string | null;
  /** `days` when the card was last answered (Support or Not now); null before the first ask. */
  askedAt: number | null;
  /** "Don't ask again": the card never comes back. */
  never: boolean;
};

const EMPTY: SupportState = { days: 0, lastDay: null, askedAt: null, never: false };

/** Today as YYYY-MM-DD in local time. */
export function dayOf(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

/** The state with `day` counted once. */
export function countDay(state: SupportState, day: string): SupportState {
  return state.lastDay === day ? state : { ...state, days: state.days + 1, lastDay: day };
}

/** Whether the card should show now. */
export function shouldAsk(state: SupportState): boolean {
  if (state.never) return false;
  if (state.askedAt === null) return state.days >= FIRST_ASK_DAYS;
  return state.days - state.askedAt >= ASK_AGAIN_DAYS;
}

/** The stored state; anything missing or malformed counts as a fresh start. */
export function readSupport(): SupportState {
  const raw = readLocalJSON(KEY);
  if (!raw || typeof raw !== "object") return EMPTY;
  const r = raw as Partial<SupportState>;
  return {
    days: typeof r.days === "number" && r.days >= 0 ? Math.floor(r.days) : 0,
    lastDay: typeof r.lastDay === "string" ? r.lastDay : null,
    askedAt: typeof r.askedAt === "number" ? r.askedAt : null,
    never: r.never === true,
  };
}

export function writeSupport(state: SupportState): void {
  writeLocalJSON(KEY, state);
}

/** Count today as a day of use (once a day; called when the app opens). */
export function recordUse(now = new Date()): void {
  const state = readSupport();
  const next = countDay(state, dayOf(now));
  if (next !== state) writeSupport(next);
}
