/**
 * One practice exercise, rendered by its interaction type (choice, gender, scramble, typed,
 * dictation) with keyboard shortcuts. Pure UI: the caller grades the answer and passes the
 * result back as `feedback`.
 *
 * Keys: 1-9 pick a choice (1 = de, 2 = het for gender), Enter submits / continues,
 * Backspace undoes the last scramble piece, ? reveals a letter of a typed answer.
 */
import { Check, Volume2, X } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import type { Exercise } from "@app/core";
import { Button } from "./Button.js";
import { cn } from "./cn.js";

/** What the learner did, reported on submit. */
export interface ExerciseSubmit {
  answer: string;
  hintsUsed: number;
}

/** Result shown after answering. */
export interface ExerciseFeedback {
  correct: boolean;
  /** Extra line from the checker, e.g. "Mind the accent." */
  note?: string;
}

export interface ExerciseCardProps {
  exercise: Exercise;
  /** null while the learner is answering. */
  feedback: ExerciseFeedback | null;
  /** The answer that was submitted (kept for colouring the choice buttons). */
  submitted?: string | null;
  onSubmit: (s: ExerciseSubmit) => void;
  onContinue: () => void;
  /** Speak a text (dictation). */
  onSpeak?: (text: string) => void;
  /** Label of the continue button (e.g. "Finish" on the last exercise). */
  continueLabel?: string;
}

/** Kinds whose prompt text is English (the rest show Dutch in the reading face). */
const ENGLISH_PROMPT = new Set(["word-choice", "scramble"]);

type Mode = "choice" | "gender" | "scramble" | "typed" | "dictation";

/** Which interaction an exercise needs (derived from its data, so new kinds degrade sensibly). */
export function exerciseMode(e: Exercise): Mode {
  if (e.kind === "gender") return "gender";
  if (e.kind === "dictation") return "dictation";
  if (e.pieces && e.pieces.length > 0) return "scramble";
  if (e.choices && e.choices.length > 0) return "choice";
  return "typed";
}

/** The prompt, with the "____" blank drawn as a hairline gap. */
function PromptText({ text, dutch }: { text: string; dutch: boolean }) {
  const parts = text.split("____");
  return (
    <p className={cn("ex-prompt", dutch && "ex-dutch")} lang={dutch ? "nl" : undefined}>
      {parts.map((p, i) => (
        <span key={i}>
          {p}
          {i < parts.length - 1 ? <span className="ex-blank" aria-label="blank" /> : null}
        </span>
      ))}
    </p>
  );
}

/** One exercise: instruction, prompt, the answering control and, after answering, feedback. */
export function ExerciseCard({
  exercise: e,
  feedback,
  submitted,
  onSubmit,
  onContinue,
  onSpeak,
  continueLabel = "Continue",
}: ExerciseCardProps) {
  const mode = exerciseMode(e);
  const answered = feedback !== null;
  const [text, setText] = useState("");
  const [hints, setHints] = useState(0);
  const [picked, setPicked] = useState<number[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const choices = mode === "gender" ? (e.choices ?? ["de", "het"]) : (e.choices ?? []);
  const pieces = e.pieces ?? [];

  const submit = (answer: string) => {
    if (answered) return;
    onSubmit({ answer, hintsUsed: hints });
  };
  const scrambleAnswer = () => picked.map((i) => pieces[i]).join(" ");
  const revealHint = () => {
    if (answered || hints >= e.answer.length) return;
    setHints((h) => h + 1);
  };

  // Speak a dictation once when it appears (the browser may block it; the button always works).
  useEffect(() => {
    if (mode === "dictation") onSpeak?.(e.prompt.speak ?? e.answer);
  }, [e.id]);

  useEffect(() => {
    if (!answered && (mode === "typed" || mode === "dictation")) inputRef.current?.focus();
  }, [e.id, answered, mode]);

  // Keyboard: window-level so it works without focusing a control first.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.repeat) return;
      if (answered) {
        // A focused button handles Enter itself (its click would otherwise fire a second time).
        if (ev.key === "Enter" && !(ev.target instanceof HTMLButtonElement)) {
          ev.preventDefault();
          onContinue();
        }
        return;
      }
      const typing = ev.target instanceof HTMLInputElement;
      if ((mode === "choice" || mode === "gender") && /^[1-9]$/.test(ev.key)) {
        const c = choices[Number(ev.key) - 1];
        if (c !== undefined) {
          ev.preventDefault();
          submit(c);
        }
      } else if (mode === "gender" && !typing && /^[dh]$/i.test(ev.key)) {
        ev.preventDefault();
        submit(ev.key.toLowerCase() === "d" ? "de" : "het");
      } else if (mode === "scramble") {
        if (ev.key === "Backspace") {
          ev.preventDefault();
          setPicked((p) => p.slice(0, -1));
        } else if (ev.key === "Enter" && picked.length === pieces.length) {
          ev.preventDefault();
          submit(scrambleAnswer());
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const onTypedSubmit = (ev: FormEvent) => {
    ev.preventDefault();
    if (text.trim()) submit(text.trim());
  };

  const dutchPrompt = !ENGLISH_PROMPT.has(e.kind);
  const hintText =
    hints > 0 ? `${e.answer.slice(0, hints)}${hints < e.answer.length ? "…" : ""}` : "";

  return (
    <section className="ex-card" aria-label="Exercise">
      <p className="ex-instruction k-overline">{e.instruction}</p>
      {mode !== "dictation" ? <PromptText text={e.prompt.text} dutch={dutchPrompt} /> : null}
      {e.prompt.hint ? <p className="ex-hint">{e.prompt.hint}</p> : null}

      {mode === "dictation" ? (
        <div className="ex-listen">
          <Button
            variant="secondary"
            onClick={() => onSpeak?.(e.prompt.speak ?? e.answer)}
            aria-label="Play audio"
          >
            <Volume2 size={16} aria-hidden /> Play
          </Button>
        </div>
      ) : null}

      {mode === "choice" || mode === "gender" ? (
        <div
          className={cn("ex-choices", mode === "gender" && "ex-choices--gender")}
          role="group"
          aria-label="Answers"
        >
          {choices.map((c, i) => {
            const state = !answered
              ? undefined
              : c === e.answer
                ? "right"
                : c === submitted
                  ? "wrong"
                  : "idle";
            return (
              <button
                key={c}
                type="button"
                className={cn("ex-choice", state && `ex-choice--${state}`)}
                disabled={answered}
                onClick={() => submit(c)}
              >
                <kbd className="ex-key">{i + 1}</kbd>
                <span
                  className={cn(mode === "gender" && "ex-gender", dutchChoice(e) && "ex-dutch")}
                >
                  {c}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {mode === "scramble" ? (
        <div className="ex-scramble">
          <div
            className="ex-built ex-dutch"
            lang="nl"
            aria-label="Your sentence"
            aria-live="polite"
          >
            {picked.length === 0 ? (
              <span className="ex-placeholder">Tap the words in order</span>
            ) : null}
            {picked.map((i, n) => (
              <button
                key={`${i}-${n}`}
                type="button"
                className="ex-piece ex-piece--placed"
                disabled={answered}
                onClick={() => setPicked((p) => p.filter((_, m) => m !== n))}
              >
                {pieces[i]}
              </button>
            ))}
          </div>
          <div className="ex-pieces ex-dutch" lang="nl" role="group" aria-label="Words">
            {pieces.map((p, i) => (
              <button
                key={i}
                type="button"
                className="ex-piece"
                disabled={answered || picked.includes(i)}
                onClick={() => setPicked((cur) => [...cur, i])}
              >
                {p}
              </button>
            ))}
          </div>
          {!answered ? (
            <div className="ex-actions">
              <Button
                variant="primary"
                disabled={picked.length !== pieces.length}
                onClick={() => submit(scrambleAnswer())}
              >
                Check
              </Button>
              <Button variant="ghost" disabled={picked.length === 0} onClick={() => setPicked([])}>
                Clear
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {mode === "typed" || mode === "dictation" ? (
        <form className="ex-typed" onSubmit={onTypedSubmit}>
          {hintText ? (
            <p className="ex-letters ex-dutch" lang="nl" aria-live="polite">
              {hintText}
            </p>
          ) : null}
          <input
            ref={inputRef}
            className="k-input ex-input ex-dutch"
            lang="nl"
            aria-label="Your answer"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={text}
            readOnly={answered}
            onChange={(ev) => setText(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === "?") {
                ev.preventDefault();
                revealHint();
              }
            }}
          />
          {!answered ? (
            <div className="ex-actions">
              <Button variant="primary" type="submit" disabled={!text.trim()}>
                Check
              </Button>
              <Button variant="ghost" onClick={revealHint} aria-label="Reveal a letter">
                Hint <kbd className="ex-key">?</kbd>
              </Button>
            </div>
          ) : null}
        </form>
      ) : null}

      {feedback ? (
        <div
          className={cn(
            "ex-feedback",
            feedback.correct ? "ex-feedback--right" : "ex-feedback--wrong",
          )}
          role="status"
        >
          <p className="ex-verdict">
            {feedback.correct ? <Check size={16} aria-hidden /> : <X size={16} aria-hidden />}
            {feedback.correct ? "Correct." : "Not quite."}
          </p>
          {!feedback.correct || e.kind === "dictation" ? (
            <p>
              Answer:{" "}
              <strong className="ex-dutch" lang="nl">
                {e.answer}
              </strong>
            </p>
          ) : null}
          {feedback.note ? <p>{feedback.note}</p> : null}
          {e.explanation ? <p className="ex-explanation">{e.explanation}</p> : null}
          {e.prompt.sentence ? (
            <p className="ex-sentence ex-dutch" lang="nl">
              {e.prompt.sentence}
            </p>
          ) : null}
          {e.prompt.translation ? <p className="ex-translation">{e.prompt.translation}</p> : null}
          <div className="ex-actions">
            <Button variant="primary" onClick={onContinue}>
              {continueLabel} <kbd className="ex-key">Enter</kbd>
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** Choices are Dutch words for the reverse and cloze exercises; English meanings otherwise. */
function dutchChoice(e: Exercise): boolean {
  return e.kind !== "meaning-choice";
}

export interface ExerciseProgressProps {
  done: number;
  total: number;
}

/** Thin session progress bar with an accessible label. */
export function ExerciseProgress({ done, total }: ExerciseProgressProps) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div
      className="ex-progress"
      role="progressbar"
      aria-label="Session progress"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
    >
      <div className="ex-progress-bar" style={{ width: `${pct}%` }} />
    </div>
  );
}
