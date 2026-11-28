/**
 * One card per word (mock merge-and-direction.html). A word held twice (the same key) merges by
 * itself; a near match ("fiets" / "de fiets" with another key, a plural, one letter off) is
 * shown as a pair for the learner to decide. A merge keeps the note with the most answers (on a
 * tie one from Anki or a file, then the oldest), so its review history stays, and fills in what
 * it lacks from the other note: the article, a meaning, the sentence, the recordings, and the
 * other word as an alias. By itself only Vuurtoren's own copies (starter words, Add to my words)
 * are removed; a note from Anki or a file goes only when the learner merges a pair.
 */
import type { AppEvent, NativeNoteFill, NativeWordNote } from "@app/db";

export interface MergePlan {
  /** The note that stays, and what it gets from the others. */
  keep: number;
  fill: NativeNoteFill;
  remove: number[];
}

/** A near match for the learner to decide. */
export interface NearPair {
  /** The note that would stay (most answers), then the one that would go. */
  keep: NativeWordNote;
  drop: NativeWordNote;
  /** Why they look alike. */
  why: "form" | "spelling";
}

/** Which note stays: the most answers, then one from Anki or a file, then the oldest. */
function better(a: NativeWordNote, b: NativeWordNote): number {
  return (
    b.reviews - a.reviews ||
    Number(a.origin === "vuurtoren") - Number(b.origin === "vuurtoren") ||
    a.note.id - b.note.id
  );
}

/** What `keep` lacks and `others` have; their keys become aliases. */
export function fillFrom(keep: NativeWordNote, others: readonly NativeWordNote[]): NativeNoteFill {
  const fill: NativeNoteFill = {};
  for (const k of [
    "article",
    "gloss",
    "sentence",
    "sentenceTranslation",
    "audio",
    "sentenceAudio",
  ] as const) {
    if (keep.note[k]) continue;
    const v = others.find((o) => o.note[k])?.note[k];
    if (v) fill[k] = v;
  }
  const aliases = others
    .flatMap((o) => [o.note.key ?? "", ...(o.note.aliases ?? [])])
    .filter((a) => a && a !== keep.note.key && !(keep.note.aliases ?? []).includes(a));
  if (aliases.length) fill.aliases = [...new Set(aliases)];
  return fill;
}

/** Words held twice under the same key: the merges that need no question. */
export function exactMerges(notes: readonly NativeWordNote[]): MergePlan[] {
  const byKey = new Map<string, NativeWordNote[]>();
  for (const n of notes) {
    const key = n.note.key;
    if (key) byKey.set(key, [...(byKey.get(key) ?? []), n]);
  }
  const plans: MergePlan[] = [];
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    const keep = [...group].sort(better)[0]!;
    const gone = group.filter((n) => n !== keep && n.origin === "vuurtoren");
    if (!gone.length) continue;
    plans.push({
      keep: keep.note.id,
      fill: fillFrom(keep, gone),
      remove: gone.map((n) => n.note.id),
    });
  }
  return plans;
}

/** One letter added, left out or changed. */
function oneOff(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

/** Endings that make a Dutch plural or another form of the same word. */
const FORM_ENDINGS = ["en", "s", "n", "e", "'s", "tje", "je"];

function looksLike(a: string, b: string): NearPair["why"] | null {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (FORM_ENDINGS.some((end) => long === short + end)) return "form";
  if (short.length >= 5 && oneOff(a, b)) return "spelling";
  return null;
}

/**
 * Near matches between different keys, after the exact merges: a key that is the other's alias
 * or a form of it, or one letter off (five letters or more). Pairs the learner kept apart
 * (`kept`: "id-id", smaller id first) are left out.
 */
export function nearPairs(
  notes: readonly NativeWordNote[],
  kept: ReadonlySet<string> = new Set(),
): NearPair[] {
  const words = notes.filter((n) => n.note.key);
  // Compare within the same first two letters: a word and its forms share them.
  const buckets = new Map<string, NativeWordNote[]>();
  for (const n of words) {
    const head = n.note.key!.slice(0, 2);
    buckets.set(head, [...(buckets.get(head) ?? []), n]);
  }
  const pairs: NearPair[] = [];
  for (const group of buckets.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]!;
        const b = group[j]!;
        const [ka, kb] = [a.note.key!, b.note.key!];
        if (ka === kb) continue;
        const id = [a.note.id, b.note.id].sort((x, y) => x - y).join("-");
        if (kept.has(id)) continue;
        const alias = (a.note.aliases ?? []).includes(kb) || (b.note.aliases ?? []).includes(ka);
        const why = alias ? "form" : looksLike(ka, kb);
        if (!why) continue;
        const [keep, drop] = better(a, b) <= 0 ? [a, b] : [b, a];
        pairs.push({ keep, drop, why });
      }
    }
  }
  return pairs;
}

/** The pair's id for "Keep both": the two note ids, smaller first. */
export function pairId(p: NearPair): string {
  return [p.keep.note.id, p.drop.note.id].sort((x, y) => x - y).join("-");
}

/** The events that carry out merges: fill the notes that stay, then remove the others. */
export function mergeEvents(lang: string, plans: readonly MergePlan[]): AppEvent[] {
  const fills = plans
    .filter((p) => Object.keys(p.fill).length)
    .map((p) => ({ id: p.keep, fill: p.fill }));
  const remove = plans.flatMap((p) => p.remove);
  return [
    ...(fills.length ? [{ type: "NativeNotesFilled" as const, lang, notes: fills }] : []),
    ...(remove.length ? [{ type: "NativeNotesRemoved" as const, lang, noteIds: remove }] : []),
  ];
}
