import { generate } from "./generate.js";
import { shuffle, type Rng } from "./rng.js";
import {
  type Exercise,
  type ExerciseKind,
  type ItemState,
  type SessionOptions,
  type Skill,
  type WordData,
} from "./types.js";

const ALL_SKILLS: readonly Skill[] = ["recognition", "gender", "form", "recall", "listening"];
const KINDS_BY_SKILL: Record<Skill, ExerciseKind[]> = {
  recognition: ["meaning-choice", "word-choice", "cloze-choice"],
  recall: ["cloze-typed"],
  form: ["perfect", "separable", "verb-form", "adjective-e", "scramble"],
  gender: ["gender"],
  listening: ["dictation"],
};

/** Order in which word states are offered as new items (lower first). */
const NEW_STATE_RANK: Partial<Record<WordData["state"], number>> = {
  learning: 0,
  known: 1,
  seen: 2,
  unknown: 3,
};

interface Item {
  key: string;
  skill: Skill;
}

const pairId = (key: string, skill: Skill) => `${key}\u0000${skill}`;

/**
 * Try the skill's kinds, least-used kind first (ties in random order), until one generates.
 * Updates `usage` so kinds vary across the session.
 */
function exerciseFor(
  item: Item,
  word: WordData,
  pool: readonly WordData[],
  usage: Map<ExerciseKind, number>,
  rng: Rng,
): Exercise | null {
  const kinds = shuffle(KINDS_BY_SKILL[item.skill], rng).sort(
    (a, b) => (usage.get(a) ?? 0) - (usage.get(b) ?? 0),
  );
  for (const kind of kinds) {
    const ex = generate(kind, word, pool, rng);
    if (ex) {
      usage.set(kind, (usage.get(kind) ?? 0) + 1);
      return ex;
    }
  }
  return null;
}

/**
 * Reorder a segment greedily, keeping priority order but avoiding the same key (and, when
 * possible, the same skill) twice in a row. `last` carries over from the previous segment.
 */
function spread(items: Exercise[], last: Exercise | undefined): Exercise[] {
  const left = [...items];
  const out: Exercise[] = [];
  let prev = last;
  while (left.length) {
    // A key holding at least half of what remains must be spread now, or it ends up adjacent.
    const counts = new Map<string, number>();
    for (const e of left) counts.set(e.key, (counts.get(e.key) ?? 0) + 1);
    const crowded = [...counts].find(([, n]) => n * 2 >= left.length && left.length > 1)?.[0];
    let i = left.findIndex((e) => e.key === crowded && e.key !== prev?.key);
    if (i < 0) i = left.findIndex((e) => e.key !== prev?.key && e.skill !== prev?.skill);
    if (i < 0) i = left.findIndex((e) => e.key !== prev?.key);
    if (i < 0) i = 0;
    const [e] = left.splice(i, 1);
    out.push(e!);
    prev = e;
  }
  return out;
}

/**
 * Build a practice session.
 * 1. Due pairs (due <= now), most overdue first.
 * 2. New pairs (never practised) up to `opts.newItems`: words in "learning" state with low
 *    pKnown first, then known, seen, unknown; ignored words are skipped.
 * 3. If still short of `opts.size`, filler: pairs not yet due, soonest due first.
 * Kinds are chosen per skill from what each word supports, least-used kind first. Within each
 * segment the order avoids repeating a key back to back and prefers alternating skills.
 * Deterministic for a given rng. Exercises are only generated for pairs whose word supports
 * the skill; others are skipped.
 */
export function buildSession(
  words: readonly WordData[],
  states: readonly ItemState[],
  opts: SessionOptions,
  rng: Rng,
): Exercise[] {
  const allowed = new Set<Skill>(opts.skills ?? ALL_SKILLS);
  const byKey = new Map(words.map((w) => [w.key, w]));
  const tracked = new Set(states.map((s) => pairId(s.key, s.skill)));
  const usable = states.filter((s) => allowed.has(s.skill) && byKey.has(s.key));
  const asItem = (s: ItemState): Item => ({ key: s.key, skill: s.skill });

  const due = usable
    .filter((s) => s.due <= opts.now)
    .sort((a, b) => a.due - b.due)
    .map(asItem);
  const upcoming = usable
    .filter((s) => s.due > opts.now)
    .sort((a, b) => a.due - b.due)
    .map(asItem);

  const usage = new Map<ExerciseKind, number>();
  const make = (item: Item) => exerciseFor(item, byKey.get(item.key)!, words, usage, rng);
  const dueEx = collect(due, opts.size, make);

  const newEx: Exercise[] = [];
  const newCap = Math.min(opts.newItems, opts.size - dueEx.length);
  // Ties (many words share a state and recall) go to more frequent words, not the alphabet.
  const candidates = words
    .filter((w) => w.state !== "ignored")
    .map((w) => ({ w, tie: rng() }))
    .sort(
      (x, y) =>
        (NEW_STATE_RANK[x.w.state] ?? 9) - (NEW_STATE_RANK[y.w.state] ?? 9) ||
        x.w.pKnown - y.w.pKnown ||
        y.w.zipf - x.w.zipf ||
        x.tie - y.tie,
    )
    .map((c) => c.w);
  // Round-robin: every word gets its first new skill before any word gets a second one, so a
  // session spreads over many words instead of drilling one word in every skill.
  // Each word starts at a different skill, so the session also spreads over skills.
  const pending = new Map(
    candidates.map((w, n) => {
      const open = ALL_SKILLS.filter((sk) => allowed.has(sk) && !tracked.has(pairId(w.key, sk)));
      const k = open.length ? n % open.length : 0;
      return [w.key, [...open.slice(k), ...open.slice(0, k)]];
    }),
  );
  while (newEx.length < newCap) {
    let progressed = false;
    for (const w of candidates) {
      if (newEx.length >= newCap) break;
      const skills = pending.get(w.key)!;
      while (skills.length) {
        const skill = skills.shift()!;
        const ex = make({ key: w.key, skill });
        if (ex) {
          newEx.push(ex);
          progressed = true;
          break;
        }
      }
    }
    if (!progressed) break;
  }

  const fillEx = collect(upcoming, opts.size - dueEx.length - newEx.length, make);

  const a = spread(dueEx, undefined);
  const b = spread(newEx, a[a.length - 1]);
  const c = spread(fillEx, b[b.length - 1] ?? a[a.length - 1]);
  return [...a, ...b, ...c];
}

/** Generate exercises for items in order until `limit` exercises exist (skipping failures). */
function collect(items: Item[], limit: number, make: (i: Item) => Exercise | null): Exercise[] {
  const out: Exercise[] = [];
  for (const item of items) {
    if (out.length >= limit) break;
    const ex = make(item);
    if (ex) out.push(ex);
  }
  return out;
}
