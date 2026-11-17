import { useEffect, useRef, useState } from "react";
import type { Exercise } from "@app/core";
import { Button, ExerciseCard, type ExerciseFeedback, type ExerciseSubmit } from "@app/ui";
import { useServices } from "../../services/context.js";
import "./courses.css";

/**
 * A short run through generated exercises (unit practice, "more like this"). Answers are graded
 * by the practice engine and scheduled per word and skill like any other practice; nothing is
 * written to Anki.
 */
export function GeneratedSession({
  exercises,
  onDone,
}: {
  exercises: Exercise[];
  onDone: (correct: number, total: number) => void;
}) {
  const services = useServices();
  const [index, setIndex] = useState(0);
  const [feedback, setFeedback] = useState<ExerciseFeedback | null>(null);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [correct, setCorrect] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // When the current card was shown (set after render; Date.now() is impure during render).
  const shownAt = useRef(0);
  useEffect(() => {
    shownAt.current = Date.now();
  }, [index]);
  const current = exercises[index];
  if (!current) return null;

  const submit = async (s: ExerciseSubmit) => {
    if (feedback) return;
    setError(null);
    try {
      const result = await services.answerExercise(current, {
        exerciseId: current.id,
        answer: s.answer,
        hintsUsed: s.hintsUsed,
        ms: Date.now() - shownAt.current,
      });
      setSubmitted(s.answer);
      setFeedback({ correct: result.correct, ...(result.note ? { note: result.note } : {}) });
      if (result.correct) setCorrect((c) => c + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The answer could not be saved.");
    }
  };

  const next = () => {
    if (index + 1 >= exercises.length) {
      onDone(correct, exercises.length);
      return;
    }
    setIndex(index + 1);
    setFeedback(null);
    setSubmitted(null);
  };

  return (
    <div className="cs-practice-card">
      <p className="k-hint">
        {index + 1} of {exercises.length}
      </p>
      <ExerciseCard
        key={current.id}
        exercise={current}
        feedback={feedback}
        submitted={submitted}
        onSubmit={(s) => void submit(s)}
        onContinue={next}
        continueLabel={index + 1 >= exercises.length ? "Finish" : "Continue"}
      />
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      <Button variant="ghost" size="sm" onClick={() => onDone(correct, index + (feedback ? 1 : 0))}>
        End
      </Button>
    </div>
  );
}
