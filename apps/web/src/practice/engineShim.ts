/**
 * TEMPORARY minimal practice engine, so the app and its tests run before the real one
 * (packages/core/src/practice/*.ts) is merged. It implements the "Engine API" documented in
 * packages/core/src/practice/types.ts with deliberately small behaviour: a simple spaced
 * scheduler instead of FSRS, and nine of the eleven exercise kinds (no `separable`,
 * `adjective-e`). Nothing outside `./engine.ts` may import this file.
 */
import {
  type Attempt,
  type Exercise,
  type ExerciseKind,
  type Grade,
  type ItemState,
  type SessionOptions,
  type Skill,
  type WordData,
  SKILL_OF,
} from "@app/core";

const DAY = 86_400_000;
const MINUTE = 60_000;

/** Deterministic PRNG (mulberry32). */
export function createRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(xs: readonly T[], rng: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Lowercase, strip accents' effect for comparison, trim punctuation and extra spaces. */
function normalise(s: string, keepAccents: boolean): string {
  let t = s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, "");
  if (!keepAccents) t = t.normalize("NFD").replace(/\p{M}/gu, "");
  return t;
}

/** Compare a typed answer with the accepted ones; accent slips are right, with a note. */
export function checkAnswer(
  exercise: Pick<Exercise, "answer" | "accept">,
  answer: string,
): { correct: boolean; note?: string } {
  const accepted = [exercise.answer, ...(exercise.accept ?? [])];
  if (accepted.some((a) => normalise(a, true) === normalise(answer, true)))
    return { correct: true };
  if (accepted.some((a) => normalise(a, false) === normalise(answer, false))) {
    return { correct: true, note: `Mind the accents: ${exercise.answer}` };
  }
  return { correct: false };
}

/** Map correctness, hints and speed to a grade. */
export function gradeAttempt(_exercise: Exercise, attempt: Attempt): Grade {
  if (!attempt.correct) return "again";
  if (attempt.hintsUsed > 0 || attempt.ms > 20_000) return "hard";
  return attempt.ms < 3_000 ? "easy" : "good";
}

/** One scheduling step for (key, skill). */
export function review(
  state: ItemState | undefined,
  key: string,
  skill: Skill,
  grade: Grade,
  now: number,
): ItemState {
  const prev: ItemState = state ?? {
    key,
    skill,
    due: now,
    stability: 0,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    state: 0,
  };
  const elapsedDays = prev.lastReview ? Math.max(0, (now - prev.lastReview) / DAY) : 0;
  const base = { ...prev, elapsedDays, reps: prev.reps + 1, lastReview: now };
  if (grade === "again") {
    return {
      ...base,
      stability: Math.max(0.5, prev.stability * 0.4),
      lapses: prev.lapses + (prev.reps > 0 ? 1 : 0),
      scheduledDays: 0,
      due: now + 10 * MINUTE,
      state: prev.state === 2 ? 3 : 1,
    };
  }
  const factor = grade === "hard" ? 1.2 : grade === "good" ? 2.2 : 3;
  const stability =
    prev.stability > 0 ? prev.stability * factor : { hard: 0.6, good: 1, easy: 3 }[grade];
  const scheduledDays = Math.max(1, Math.round(stability));
  return { ...base, stability, scheduledDays, due: now + scheduledDays * DAY, state: 2 };
}

/** Counts of due items and learned (in review) items overall and per skill. */
export function practiceStats(
  states: readonly ItemState[],
  now: number,
): { due: number; learned: number; bySkill: Record<Skill, number> } {
  const bySkill: Record<Skill, number> = {
    recognition: 0,
    recall: 0,
    form: 0,
    gender: 0,
    listening: 0,
  };
  let due = 0;
  let learned = 0;
  for (const s of states) {
    if (s.due <= now) due++;
    if (s.state === 2) {
      learned++;
      bySkill[s.skill]++;
    }
  }
  return { due, learned, bySkill };
}

/** Other words of the same part of speech as plausible wrong answers. */
export function distractors(
  word: WordData,
  pool: readonly WordData[],
  n: number,
  rng: () => number,
  by: "lemma" | "gloss" = "lemma",
): string[] {
  const text = (w: WordData) => (by === "gloss" ? w.glosses[0] : w.lemma);
  const own = text(word);
  const candidates = pool.filter((w) => w.key !== word.key && text(w) && text(w) !== own);
  const samePos = candidates.filter((w) => w.pos === word.pos);
  const ordered = shuffle(samePos.length >= n ? samePos : candidates, rng);
  return [...new Set(ordered.map((w) => text(w)!))].slice(0, n);
}

/** Replace the target span of a sentence with "____". */
function blanked(s: { text: string; target: [number, number] }): string {
  return `${s.text.slice(0, s.target[0])}____${s.text.slice(s.target[1])}`;
}

const base = (kind: ExerciseKind, word: WordData, id: string, instruction: string) => ({
  id,
  kind,
  skill: SKILL_OF[kind],
  key: word.key,
  instruction,
});

/** Build one exercise of `kind`, or null when the word lacks the data for it. */
export function generate(
  kind: ExerciseKind,
  word: WordData,
  pool: readonly WordData[],
  rng: () => number,
): Exercise | null {
  const id = `${word.key}:${kind}:${Math.floor(rng() * 1e9).toString(36)}`;
  const gloss = word.glosses[0];
  const sentence = word.sentences[0];
  switch (kind) {
    case "meaning-choice": {
      const wrong = distractors(word, pool, 3, rng, "gloss");
      if (!gloss || wrong.length < 2) return null;
      return {
        ...base(kind, word, id, "Choose the meaning"),
        prompt: { text: word.article ? `${word.article} ${word.lemma}` : word.lemma },
        choices: shuffle([gloss, ...wrong], rng),
        answer: gloss,
      };
    }
    case "word-choice": {
      const wrong = distractors(word, pool, 3, rng);
      if (!gloss || wrong.length < 2) return null;
      return {
        ...base(kind, word, id, "Choose the Dutch word"),
        prompt: { text: gloss },
        choices: shuffle([word.lemma, ...wrong], rng),
        answer: word.lemma,
      };
    }
    case "cloze-choice":
    case "cloze-typed": {
      if (!sentence) return null;
      const wrong = kind === "cloze-choice" ? distractors(word, pool, 3, rng) : [];
      if (kind === "cloze-choice" && wrong.length < 2) return null;
      const surface = sentence.text.slice(...sentence.target);
      return {
        ...base(
          kind,
          word,
          id,
          kind === "cloze-choice" ? "Choose the missing word" : "Type the missing word",
        ),
        prompt: {
          text: blanked(sentence),
          sentence: sentence.text,
          ...(sentence.translation ? { translation: sentence.translation } : {}),
          ...(kind === "cloze-typed" && gloss ? { hint: gloss } : {}),
        },
        ...(kind === "cloze-choice" ? { choices: shuffle([surface, ...wrong], rng) } : {}),
        answer: surface,
      };
    }
    case "gender":
      if (!word.article) return null;
      return {
        ...base(kind, word, id, "de or het?"),
        prompt: { text: word.lemma },
        choices: ["de", "het"],
        answer: word.article,
        explanation: word.article === "het" ? "Neuter nouns take het." : "Most nouns take de.",
      };
    case "perfect": {
      const f = word.forms;
      if (!f?.participle || !f.aux || f.aux === "both") return null;
      const aux = f.aux === "zijn" ? "is" : "heeft";
      return {
        ...base(kind, word, id, "Type the perfect tense"),
        prompt: {
          text: `Hij ____ ____. (${word.lemma})`,
          hint: "heeft or is, then the participle",
        },
        answer: `${aux} ${f.participle}`,
        explanation:
          aux === "is" ? "zijn: verbs of motion or change of state." : "Most verbs use hebben.",
      };
    }
    case "verb-form": {
      const f = word.forms;
      if (!f?.past) return null;
      return {
        ...base(kind, word, id, "Type the form"),
        prompt: { text: `${word.lemma}: past tense, plural` },
        answer: f.past[1],
      };
    }
    case "scramble": {
      if (!sentence) return null;
      const words = sentence.text.split(/\s+/).filter(Boolean);
      if (words.length < 3 || words.length > 10) return null;
      return {
        ...base(kind, word, id, "Put the words in order"),
        prompt: { text: sentence.translation ?? "Build the sentence", sentence: sentence.text },
        pieces: shuffle(words, rng),
        answer: words.join(" "),
      };
    }
    case "dictation":
      return {
        ...base(kind, word, id, "Listen and type what you hear"),
        prompt: { text: "", speak: word.lemma },
        answer: word.lemma,
      };
    default:
      return null;
  }
}

const KINDS_OF_SKILL: Record<Skill, ExerciseKind[]> = {
  recognition: ["meaning-choice", "word-choice", "cloze-choice"],
  recall: ["cloze-typed"],
  form: ["perfect", "verb-form", "scramble"],
  gender: ["gender"],
  listening: ["dictation"],
};

/** Due items first, then never-practised ones (at most `newItems`), mixed kinds. */
export function buildSession(
  words: readonly WordData[],
  states: readonly ItemState[],
  opts: SessionOptions,
  rng: () => number,
): Exercise[] {
  const allowed = new Set<Skill>(opts.skills ?? (Object.keys(KINDS_OF_SKILL) as Skill[]));
  const stateOf = new Map(states.map((s) => [`${s.key}|${s.skill}`, s]));
  const make = (word: WordData, skill: Skill): Exercise | null => {
    for (const kind of shuffle(KINDS_OF_SKILL[skill], rng)) {
      const ex = generate(kind, word, words, rng);
      if (ex) return ex;
    }
    return null;
  };
  const due: Exercise[] = [];
  const fresh: Exercise[] = [];
  for (const word of shuffle(words, rng)) {
    for (const skill of allowed) {
      const st = stateOf.get(`${word.key}|${skill}`);
      if (st && st.due > opts.now) continue;
      if (!st && fresh.length >= opts.newItems) continue;
      const ex = make(word, skill);
      if (ex) (st ? due : fresh).push(ex);
    }
  }
  return [...due, ...shuffle(fresh, rng)].slice(0, opts.size);
}
