/**
 * Practice for the mock services: a believable fixed set of Dutch exercises that covers every
 * exercise kind, graded by the same engine adapter as the live app. State lives in memory.
 */
import { type Exercise, type ExerciseKind, type ItemState, type Skill, SKILL_OF } from "@app/core";
import { checkAnswer, gradeAttempt, practiceStats, review } from "../practice/engine.js";
import type { AnswerResult, AttemptInput, PracticeOptions, PracticeOverview } from "./types.js";

const DAY = 86_400_000;

/** Compact exercise builder: fills id, skill and key defaults. */
function ex(
  kind: ExerciseKind,
  key: string,
  instruction: string,
  rest: Omit<Exercise, "id" | "kind" | "skill" | "key" | "instruction">,
): Exercise {
  return { id: `mock-${key}-${kind}`, kind, skill: SKILL_OF[kind], key, instruction, ...rest };
}

/** One of every kind first, then more of the common ones. */
export const MOCK_EXERCISES: Exercise[] = [
  ex("meaning-choice", "gracht", "Choose the meaning", {
    prompt: { text: "de gracht" },
    choices: ["canal", "garden", "bridge", "shed"],
    answer: "canal",
  }),
  ex("cloze-typed", "brug", "Type the missing word", {
    prompt: {
      text: "Wij lopen over de ____ naar het station.",
      sentence: "Wij lopen over de brug naar het station.",
      translation: "We walk across the bridge to the station.",
      hint: "bridge",
    },
    answer: "brug",
  }),
  ex("gender", "schuur", "de or het?", {
    prompt: { text: "schuur" },
    choices: ["de", "het"],
    answer: "de",
    explanation: "Most nouns take de.",
  }),
  ex("word-choice", "tuin", "Choose the Dutch word", {
    prompt: { text: "garden" },
    choices: ["tuin", "tuig", "tuit", "tijn"],
    answer: "tuin",
  }),
  ex("cloze-choice", "reis", "Choose the missing word", {
    prompt: {
      text: "Zij maakt een lange ____ door Europa.",
      sentence: "Zij maakt een lange reis door Europa.",
      translation: "She is making a long journey through Europe.",
    },
    choices: ["reis", "regen", "ruimte", "rust"],
    answer: "reis",
  }),
  ex("perfect", "lopen", "Type the perfect tense", {
    prompt: { text: "Hij ____ ____ naar huis. (lopen)", hint: "heeft or is, then the participle" },
    answer: "is gelopen",
    accept: ["is naar huis gelopen"],
    explanation: "zijn: verbs of motion.",
  }),
  ex("verb-form", "nemen", "Type the form", {
    prompt: { text: "nemen: past tense, plural" },
    answer: "namen",
  }),
  ex("adjective-e", "mooi", "Choose the right form", {
    prompt: {
      text: "Het is een ____ huis.",
      sentence: "Het is een mooi huis.",
      translation: "It is a beautiful house.",
    },
    choices: ["mooi", "mooie"],
    answer: "mooi",
    explanation: "No -e after een with a het-word.",
  }),
  ex("separable", "opbellen", "Choose the correct sentence", {
    prompt: { text: "Call me up tomorrow." },
    choices: [
      "Bel mij morgen op.",
      "Op mij morgen bel.",
      "Mij bel morgen op.",
      "Bel op mij morgen.",
    ],
    answer: "Bel mij morgen op.",
    explanation: "The particle goes to the end of the sentence.",
  }),
  ex("scramble", "fiets", "Put the words in order", {
    prompt: { text: "The bike is red.", sentence: "De fiets is rood." },
    pieces: ["rood", "is", "De", "fiets"],
    answer: "De fiets is rood.",
    accept: ["De fiets is rood"],
  }),
  ex("dictation", "huis", "Listen and type what you hear", {
    prompt: { text: "", speak: "het huis" },
    answer: "het huis",
  }),
  ex("gender", "boek", "de or het?", {
    prompt: { text: "boek" },
    choices: ["de", "het"],
    answer: "het",
    explanation: "Neuter nouns take het.",
  }),
  ex("meaning-choice", "neemt", "Choose the meaning", {
    prompt: { text: "nemen" },
    choices: ["to take", "to name", "to give", "to need"],
    answer: "to take",
  }),
];

/** A few practised items so the overview is not empty on first load. */
function seedStates(now: number): ItemState[] {
  const mk = (key: string, skill: Skill, dueIn: number): ItemState => ({
    key,
    skill,
    due: now + dueIn,
    stability: 4,
    difficulty: 5,
    elapsedDays: 2,
    scheduledDays: 4,
    reps: 3,
    lapses: 0,
    state: 2,
    lastReview: now - 2 * DAY,
  });
  return [
    mk("gracht", "recognition", -DAY),
    mk("schuur", "gender", -DAY / 2),
    mk("brug", "recall", 3 * DAY),
    mk("huis", "recognition", 5 * DAY),
  ];
}

/** In-memory practice service; `wait` simulates latency. */
export function createMockPractice(wait: () => Promise<void>) {
  const items = new Map<string, ItemState>();
  for (const s of seedStates(Date.now())) items.set(`${s.key}|${s.skill}`, s);
  let lastAnswer: number | null = null;

  return {
    async practiceOverview(): Promise<PracticeOverview> {
      await wait();
      const stats = practiceStats([...items.values()], Date.now());
      const fresh = new Set(
        MOCK_EXERCISES.filter((e) => !items.has(`${e.key}|${e.skill}`)).map((e) => e.key),
      );
      return { ...stats, newAvailable: fresh.size, lastSession: lastAnswer };
    },

    async startPractice(opts: PracticeOptions = {}): Promise<Exercise[]> {
      await wait();
      // Demo: pretend three words got validated AI sentences (one was rejected).
      if (opts.aiSentences)
        opts.onAISentences?.({ requested: 3, accepted: 7, rejected: 1, reused: 0 });
      const now = Date.now();
      const pool = MOCK_EXERCISES.filter((e) => !opts.skills || opts.skills.includes(e.skill));
      const isDue = (e: Exercise) => (items.get(`${e.key}|${e.skill}`)?.due ?? -1) <= now;
      return pool.filter(isDue).slice(0, opts.size ?? 20);
    },

    async answerExercise(exercise: Exercise, attempt: AttemptInput): Promise<AnswerResult> {
      await wait();
      const checked = checkAnswer(exercise, attempt.answer);
      const grade = gradeAttempt(exercise, { ...attempt, correct: checked.correct });
      const id = `${exercise.key}|${exercise.skill}`;
      const next = review(items.get(id), exercise.key, exercise.skill, grade, Date.now());
      items.set(id, next);
      lastAnswer = Date.now();
      return {
        grade,
        correct: checked.correct,
        ...(checked.note ? { note: checked.note } : {}),
        next,
      };
    },
  };
}
