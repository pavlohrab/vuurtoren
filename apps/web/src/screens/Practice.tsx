import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Exercise, Skill } from "@app/core";
import {
  Button,
  Chip,
  ExerciseCard,
  ExerciseProgress,
  type ExerciseFeedback,
  type ExerciseSubmit,
  Skeleton,
} from "@app/ui";
import { dutchVoiceAvailable, speakDutch } from "../practice/speech.js";
import { useServices } from "../services/context.js";
import type { AnswerResult } from "../services/types.js";

export const SKILLS: { skill: Skill; label: string }[] = [
  { skill: "recognition", label: "Recognition" },
  { skill: "recall", label: "Recall" },
  { skill: "form", label: "Forms" },
  { skill: "gender", label: "Gender" },
  { skill: "listening", label: "Listening" },
];
const SIZES = [10, 20, 30];

/** One answered exercise of the running session. */
interface Answered {
  exercise: Exercise;
  result: AnswerResult;
}

type Phase =
  | { name: "start" }
  | { name: "loading" }
  | { name: "session"; exercises: Exercise[]; listening: boolean }
  | { name: "summary"; answered: Answered[]; skipped: number; empty: boolean };

/** Practice: start view, one exercise per screen, then a quiet summary. */
export function Practice() {
  const [phase, setPhase] = useState<Phase>({ name: "start" });
  const [error, setError] = useState<string | null>(null);
  const services = useServices();
  const client = useQueryClient();

  const start = async (size: number, skills: Skill[]) => {
    setError(null);
    setPhase({ name: "loading" });
    try {
      const exercises = await services.startPractice({ size, skills });
      if (exercises.length === 0) {
        setPhase({ name: "summary", answered: [], skipped: 0, empty: true });
        return;
      }
      const listening = exercises.some((e) => e.kind === "dictation")
        ? await dutchVoiceAvailable()
        : true;
      setPhase({ name: "session", exercises, listening });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase({ name: "start" });
    }
  };

  const finish = (answered: Answered[], skipped: number) => {
    void client.invalidateQueries({ queryKey: ["practice"] });
    setPhase({ name: "summary", answered, skipped, empty: false });
  };

  return (
    <div className="page page--narrow practice">
      {phase.name === "start" || phase.name === "loading" ? (
        <StartView loading={phase.name === "loading"} error={error} onStart={start} />
      ) : phase.name === "session" ? (
        <Session exercises={phase.exercises} listening={phase.listening} onFinish={finish} />
      ) : (
        <Summary
          answered={phase.answered}
          skipped={phase.skipped}
          empty={phase.empty}
          onAgain={() => setPhase({ name: "start" })}
        />
      )}
    </div>
  );
}

function StartView({
  loading,
  error,
  onStart,
}: {
  loading: boolean;
  error: string | null;
  onStart: (size: number, skills: Skill[]) => void;
}) {
  const services = useServices();
  const overview = useQuery({
    queryKey: ["practice", "overview"],
    queryFn: () => services.practiceOverview(),
  });
  const [skills, setSkills] = useState<Skill[]>(SKILLS.map((s) => s.skill));
  const [size, setSize] = useState(20);
  const o = overview.data;

  const toggle = (s: Skill) =>
    setSkills((cur) =>
      cur.includes(s) ? (cur.length > 1 ? cur.filter((x) => x !== s) : cur) : [...cur, s],
    );

  return (
    <>
      <h1>Practice</h1>
      <p className="page-lede">
        {o
          ? `${o.due} due · ${o.newAvailable} new`
          : "Short exercises from words you are learning."}
      </p>

      {overview.isPending ? <Skeleton style={{ height: 24, width: 160 }} /> : null}

      <fieldset className="practice-group">
        <legend className="k-label">Skills</legend>
        <div className="practice-options">
          {SKILLS.map(({ skill, label }) => (
            <button
              key={skill}
              type="button"
              className="practice-option"
              aria-pressed={skills.includes(skill)}
              onClick={() => toggle(skill)}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="practice-group">
        <legend className="k-label">Session length</legend>
        <div className="practice-options">
          {SIZES.map((n) => (
            <button
              key={n}
              type="button"
              className="practice-option"
              aria-pressed={size === n}
              onClick={() => setSize(n)}
            >
              {n} exercises
            </button>
          ))}
        </div>
      </fieldset>

      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      <Button variant="primary" disabled={loading} onClick={() => onStart(size, skills)}>
        {loading ? "Preparing…" : "Start"}
      </Button>
      <p className="k-hint practice-note">
        Practice keeps its own schedule. Nothing here changes your Anki cards.
      </p>
    </>
  );
}

function Session({
  exercises,
  listening,
  onFinish,
}: {
  exercises: Exercise[];
  listening: boolean;
  onFinish: (answered: Answered[], skipped: number) => void;
}) {
  const services = useServices();
  const [index, setIndex] = useState(0);
  const [answered, setAnswered] = useState<Answered[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [feedback, setFeedback] = useState<ExerciseFeedback | null>(null);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shownAt = useRef(0);
  const skippedAt = useRef(-1);
  const current = exercises[index];
  const skipDictation = current?.kind === "dictation" && !listening;

  // Keep the latest values reachable from the Escape handler and the skip effect.
  const latest = useRef({ answered, skipped });
  useEffect(() => {
    latest.current = { answered, skipped };
  });

  const advance = useCallback(
    (nextAnswered: Answered[], nextSkipped: number) => {
      if (index + 1 >= exercises.length) onFinish(nextAnswered, nextSkipped);
      else {
        setIndex(index + 1);
        setFeedback(null);
        setSubmitted(null);
        setError(null);
      }
    },
    [index, exercises.length, onFinish],
  );

  // Dictation needs a Dutch voice: without one the exercise is skipped and counted.
  useEffect(() => {
    if (!skipDictation || skippedAt.current === index) return;
    skippedAt.current = index;
    setSkipped((n) => n + 1);
    advance(latest.current.answered, latest.current.skipped + 1);
  }, [skipDictation, advance, index]);

  useEffect(() => {
    shownAt.current = Date.now();
  }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFinish(latest.current.answered, latest.current.skipped);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onFinish]);

  const submit = async (s: ExerciseSubmit) => {
    if (!current || busy || feedback) return;
    setBusy(true);
    setError(null);
    try {
      const result = await services.answerExercise(current, {
        exerciseId: current.id,
        answer: s.answer,
        hintsUsed: s.hintsUsed,
        ms: Date.now() - shownAt.current,
      });
      setSubmitted(s.answer);
      setAnswered((a) => [...a, { exercise: current, result }]);
      setFeedback({ correct: result.correct, ...(result.note ? { note: result.note } : {}) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The answer could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!current || skipDictation) return null;
  const last = index === exercises.length - 1;
  return (
    <>
      <div className="practice-top">
        <span className="k-hint">
          {index + 1} of {exercises.length}
        </span>
        <Button variant="ghost" size="sm" onClick={() => onFinish(answered, skipped)}>
          End session <kbd className="ex-key">Esc</kbd>
        </Button>
      </div>
      <ExerciseProgress done={index + (feedback ? 1 : 0)} total={exercises.length} />
      <div className="practice-card">
        <ExerciseCard
          key={current.id}
          exercise={current}
          feedback={feedback}
          submitted={submitted}
          onSubmit={(s) => void submit(s)}
          onContinue={() => advance(answered, skipped)}
          onSpeak={speakDutch}
          continueLabel={last ? "Finish" : "Continue"}
        />
      </div>
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

function Summary({
  answered,
  skipped,
  empty,
  onAgain,
}: {
  answered: Answered[];
  skipped: number;
  empty: boolean;
  onAgain: () => void;
}) {
  if (empty) {
    return (
      <>
        <h1>Practice</h1>
        <p className="page-lede">
          Nothing to practise yet. Sync Anki in Settings, or read a text and start learning a few
          words.
        </p>
        <Button onClick={onAgain}>Back</Button>
      </>
    );
  }
  const correct = answered.filter((a) => a.result.correct).length;
  const started = answered.filter((a) => a.result.next.reps === 1).length;
  const relearned = answered.filter(
    (a) => a.result.grade === "again" && a.result.next.reps > 1,
  ).length;
  const again = [...new Set(answered.filter((a) => !a.result.correct).map((a) => a.exercise.key))];
  return (
    <>
      <h1>Session complete</h1>
      <p className="page-lede">
        {answered.length === 0
          ? "No exercises were answered."
          : `${correct} of ${answered.length} correct.`}
      </p>
      <div className="stat-grid">
        <div className="stat">
          <div className="stat-value">{started}</div>
          <div className="stat-label">Items started</div>
        </div>
        <div className="stat">
          <div className="stat-value">{relearned}</div>
          <div className="stat-label">Items to relearn</div>
        </div>
      </div>
      {skipped > 0 ? (
        <p className="k-hint practice-note">
          {skipped} listening {skipped === 1 ? "exercise was" : "exercises were"} skipped: no Dutch
          voice is available in this browser.
        </p>
      ) : null}
      {again.length > 0 ? (
        <section className="practice-group">
          <h2 className="practice-h2">Words to look at again</h2>
          <div className="practice-options">
            {again.map((k) => (
              <Link key={k} to="/words" className="practice-word">
                <Chip tone="warm">{k}</Chip>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
      <div className="practice-actions">
        <Button variant="primary" onClick={onAgain}>
          Practice again
        </Button>
        <Link to="/words" className="k-btn k-btn--secondary">
          Words
        </Link>
      </div>
    </>
  );
}
