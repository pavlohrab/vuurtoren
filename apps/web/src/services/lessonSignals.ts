/**
 * What the app knows about each word, as the lesson builder wants it (algorithms.md 4.7.1):
 * from the word list (state, recall now, taps and the last tap, app evidence) and the practice
 * answers (recent misses, how safe the word is). Pure, so it is tested without a database.
 */
import type { EloAnswer, ExerciseKind, WordSignals } from "@app/core";
import type { WordInfo } from "@app/db";

const DAY_MS = 86_400_000;
/** Taps in this window lower a word's starting grip. */
const RECENT_TAPS_DAYS = 14;
/** A word is safe for now after this many right answers in a row. */
const SAFE_STREAK = 3;

/** Words a lesson may use: ones you learn or know, and ones you tapped while reading. */
export const lessonCandidate = (w: WordInfo): boolean =>
  w.state === "learning" || w.state === "known" || (w.state !== "ignored" && w.lookups > 0);

/** The answers as the engine's Elo replay takes them (unknown kinds are dropped). */
export function toEloAnswers(
  rows: readonly { key: string; kind: string; result: number; at: number }[],
  kinds: ReadonlySet<string>,
): EloAnswer[] {
  return rows.filter((r) => kinds.has(r.kind)).map((r) => ({ ...r, kind: r.kind as ExerciseKind }));
}

export function lessonSignals(
  infos: readonly WordInfo[],
  answers: readonly EloAnswer[],
  now: number,
  zipfOf: (key: string) => number = () => 4,
): WordSignals[] {
  const byKey = new Map<string, EloAnswer[]>();
  for (const a of answers) {
    const xs = byKey.get(a.key);
    if (xs) xs.push(a);
    else byKey.set(a.key, [a]);
  }
  return infos.filter(lessonCandidate).map((w) => {
    const mine = byKey.get(w.key) ?? [];
    const practiceRight = mine.filter((a) => a.result >= 0.5).length;
    const practiceWrong = mine.length - practiceRight;
    // App evidence counts practice and reader answers together; take practice out again.
    const ev = w.evidence;
    const netClozes = ev
      ? Math.max(-3, Math.min(3, ev.correct - ev.wrong - (practiceRight - practiceWrong)))
      : 0;
    const lastMiss = [...mine].reverse().find((a) => a.result < 0.5)?.at;
    const recent = w.lastLookupAt !== undefined && now - w.lastLookupAt < RECENT_TAPS_DAYS * DAY_MS;
    const streak = mine.slice(-SAFE_STREAK);
    const s: WordSignals = {
      key: w.key,
      state: w.state,
      pKnown: w.pKnown,
      hasCard: w.state === "learning" || w.state === "known",
      taps: w.lookups,
      recentTaps: recent ? Math.min(w.lookups, 3) : 0,
      netClozes,
      reviewedToday: false,
      practiceSafe: streak.length === SAFE_STREAK && streak.every((a) => a.result === 1),
      onPage: false,
      onNextPages: false,
      zipf: zipfOf(w.key),
      dismissed: false,
    };
    if (w.lastLookupAt !== undefined) s.lastTapAt = w.lastLookupAt;
    if (lastMiss !== undefined) s.lastWrongAt = lastMiss;
    return s;
  });
}
