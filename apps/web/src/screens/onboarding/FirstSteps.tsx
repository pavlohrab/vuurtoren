/**
 * The end of the welcome (mock-practice-words, "The end of onboarding"): three practice
 * questions with the first words, Check your level on 20 words from four frequency bands, and
 * what Vuurtoren takes from it. The words come from the placement list (placementWords.ts).
 */
import type { Exercise } from "@app/core";
import { starterBand } from "@app/anki";
import { Button, ExerciseCard, type ExerciseFeedback } from "@app/ui";
import { useMemo, useState } from "react";
import type { PlacementBand } from "../../services/profileTypes.js";

/** Practice questions before the level check. */
const QUESTIONS = 3;
/** Words per band in the level check (four bands: 20 words). */
const PER_BAND = 5;
/** How many of the most common words each band stands for (its rank range). */
const BAND_SIZE = [100, 400, 1500, 3000];
/** The starter list's levels are 500 words each (starterBand). */
const LEVEL_SIZE = 500;

function shuffle<T>(xs: readonly T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Three "Choose the meaning" questions with the most common words. */
export function practiceQuestions(bands: readonly PlacementBand[]): Exercise[] {
  const words = bands[0]?.words ?? [];
  return shuffle(words)
    .slice(0, QUESTIONS)
    .map((w, i) => {
      const others = shuffle(words.filter((o) => o.key !== w.key && o.gloss !== w.gloss))
        .slice(0, 2)
        .map((o) => o.gloss);
      return {
        id: `welcome-${i}`,
        kind: "meaning-choice",
        skill: "recognition",
        key: w.key,
        instruction: "Choose the meaning",
        prompt: { text: w.word },
        choices: shuffle([w.gloss, ...others]),
        answer: w.gloss,
      };
    });
}

export function TryPractice({
  bands,
  onDone,
}: {
  bands: readonly PlacementBand[];
  onDone: () => void;
}) {
  const questions = useMemo(() => practiceQuestions(bands), [bands]);
  const [at, setAt] = useState(0);
  const [feedback, setFeedback] = useState<ExerciseFeedback | null>(null);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const current = questions[at];
  if (!current) return null;
  const last = at === questions.length - 1;
  return (
    <div className="ob-practice">
      <ExerciseCard
        key={current.id}
        exercise={current}
        feedback={feedback}
        submitted={submitted}
        continueLabel={last ? "Next" : "Continue"}
        onSubmit={({ answer }) => {
          setSubmitted(answer);
          setFeedback({ correct: answer === current.answer });
        }}
        onContinue={() => {
          if (last) return onDone();
          setAt(at + 1);
          setFeedback(null);
          setSubmitted(null);
        }}
      />
    </div>
  );
}

export interface LevelWord {
  key: string;
  word: string;
  band: number;
}

/** Five words from each band, the common ones first. */
export function levelWords(bands: readonly PlacementBand[]): LevelWord[] {
  return bands.flatMap((b, band) =>
    shuffle(b.words)
      .slice(0, PER_BAND)
      .map((w) => ({ key: w.key, word: w.word, band })),
  );
}

export function LevelCheck({
  words,
  onDone,
}: {
  words: readonly LevelWord[];
  onDone: (known: LevelWord[]) => void;
}) {
  const [at, setAt] = useState(0);
  const [known, setKnown] = useState<LevelWord[]>([]);
  const current = words[at];
  if (!current) return null;
  const answer = (knows: boolean) => {
    const next = knows ? [...known, current] : known;
    setKnown(next);
    if (at + 1 >= words.length) onDone(next);
    else setAt(at + 1);
  };
  return (
    <div className="ob-level">
      <div className="ob-level-card" lang="nl" aria-live="polite">
        {current.word}
      </div>
      <div className="ob-level-buttons">
        <Button onClick={() => answer(false)}>Not yet</Button>
        <Button variant="primary" onClick={() => answer(true)}>
          I know it
        </Button>
      </div>
      <p className="ob-level-count" aria-hidden>
        {at + 1} of {words.length}
      </p>
    </div>
  );
}

export interface LevelEstimate {
  /** About this many of the most common words, rounded to 100. */
  words: number;
  band: string;
}

/** Each band's share of known words, times the ranks it stands for. */
export function estimateLevel(
  words: readonly LevelWord[],
  known: readonly LevelWord[],
): LevelEstimate {
  let total = 0;
  BAND_SIZE.forEach((size, band) => {
    const asked = words.filter((w) => w.band === band).length;
    if (!asked) return;
    total += (size * known.filter((w) => w.band === band).length) / asked;
  });
  const rounded = Math.round(total / 100) * 100;
  return { words: rounded, band: starterBand(Math.max(1, Math.ceil(total / LEVEL_SIZE))) };
}

/** The level bars: A1 up to 1,000 words, A2 up to 2,000, B1 up to 3,500 (starterBand). */
const BARS: [string, number, number][] = [
  ["A1", 0, 1000],
  ["A2", 1000, 2000],
  ["B1", 2000, 3500],
];

export function LevelResult({ estimate }: { estimate: LevelEstimate }) {
  return (
    <div className="ob-result">
      <div className="ob-result-bars">
        {BARS.map(([name, lo, hi]) => (
          <div key={name} className="ob-result-bar" data-here={name === estimate.band || undefined}>
            <b>{name}</b>
            <span>
              <i
                style={{
                  width: `${Math.max(0, Math.min(1, (estimate.words - lo) / (hi - lo))) * 100}%`,
                }}
              />
            </span>
          </div>
        ))}
      </div>
      <ul className="ob-result-list">
        <li>skip the words you know</li>
        <li>start with {estimate.band} stories</li>
        <li>mark fewer words when you read</li>
      </ul>
    </div>
  );
}
