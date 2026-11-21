/**
 * Schrijven: write first (exam mode: all tasks of a set against one clock, like the paper exam),
 * then check each answer with the checklist and the model answer. Optional AI feedback when a
 * provider is configured; the score is what you tick (AI verdicts tick task points for you).
 */
import { plural } from "../../format.js";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import { type WritingTask, countAnswerWords, examBank, scoreRubric } from "@app/content";
import { Button, Dialog, Input, Textarea } from "@app/ui";
import { useBlocker } from "@tanstack/react-router";
import { readLocalJSON, writeLocalJSON } from "../../storage/local.js";
import { useBackClose } from "../../shell/backStack.js";
import { useServices } from "../../services/context.js";
import type { ExamFeedback } from "../../services/examTypes.js";
import { errorText } from "../../services/errors.js";
import { useExamClock } from "../../exam/timer.js";
import { ExamClock, GrammarLinks, SaveScore, ScoreCard, useRecordAttempt } from "./shared.js";

type Answer = { text: string; fields: string[] };

/** Checklist of one task: its own points, then the general rubric of its kind. */
function checklist(task: WritingTask): string[] {
  const rubric = examBank().schrijven.rubric;
  return [...task.points, ...(task.kind === "form" ? rubric.form : rubric.message)];
}

/** The answer as plain text (forms: "Label: value" lines), for AI feedback. */
function answerText(task: WritingTask, a: Answer): string {
  if (task.kind !== "form") return a.text;
  return (task.fields ?? []).map((f, i) => `${f.label}: ${a.fields[i] ?? ""}`).join("\n");
}

export function WritingSession({
  mode,
  tasks,
  setId,
  title,
  limitMs,
  onExit,
}: {
  mode: "exam" | "practice";
  tasks: WritingTask[];
  setId: string;
  title: string;
  limitMs: number;
  onExit: () => void;
}) {
  // Answers are kept as a draft on this device (per set and mode) until the result is saved,
  // so Back, another tab or a closed app never loses them.
  const draftKey = `vuurtoren.exam.schrijven.${mode}.${setId}`;
  const [answers, setAnswersState] = useState<Record<string, Answer>>(() => {
    const kept = readLocalJSON(draftKey) as Record<string, Answer> | undefined;
    return Object.fromEntries(
      tasks.map((t) => {
        const a = kept?.[t.id];
        const blank = { text: "", fields: (t.fields ?? []).map(() => "") };
        return [t.id, a && typeof a.text === "string" && Array.isArray(a.fields) ? a : blank];
      }),
    );
  });
  const setAnswers = (update: (all: Record<string, Answer>) => Record<string, Answer>) =>
    setAnswersState((all) => {
      const next = update(all);
      writeLocalJSON(draftKey, next);
      return next;
    });
  const [phase, setPhase] = useState<"write" | "check">("write");
  const [ticks, setTicks] = useState<Record<string, boolean[]>>({});
  const clock = useExamClock(mode === "exam" ? limitMs : null, phase === "write", () => handIn());
  const [took, setTook] = useState(0);
  const recordAttempt = useRecordAttempt();
  // A timed attempt with something written: leaving it (Back on screen or on the phone, another
  // tab) asks first. The answers stay in the draft either way.
  const written = Object.values(answers).some(
    (a) => a.text.trim() || a.fields.some((f) => f.trim()),
  );
  const guarded = mode === "exam" && phase === "write" && written;
  const allowLeave = useRef(false);
  const leave = useBlocker({
    shouldBlockFn: () => guarded && !allowLeave.current,
    enableBeforeUnload: () => guarded,
    withResolver: true,
  });
  // Android Back reaches the session before any navigation: it asks the same question.
  const [asking, setAsking] = useState(false);
  useBackClose(guarded, () => setAsking(true));
  const stay = () => {
    setAsking(false);
    leave.reset?.();
  };
  const go = () => {
    setAsking(false);
    if (leave.status === "blocked") leave.proceed?.();
    else {
      allowLeave.current = true;
      onExit();
    }
  };

  function handIn() {
    setTook(clock.elapsed);
    // Pre-tick what can be checked automatically: every field filled, enough words.
    setTicks(
      Object.fromEntries(
        tasks.map((t) => {
          const a = answers[t.id]!;
          const list = checklist(t);
          return [
            t.id,
            list.map((item) =>
              t.kind === "form"
                ? /alle vakjes/i.test(item) && a.fields.every((f) => f.trim())
                : /genoeg woorden/i.test(item) && countAnswerWords(a.text) >= (t.minWords ?? 0),
            ),
          ];
        }),
      ),
    );
    setPhase("check");
  }

  const total = tasks.reduce((n, t) => n + checklist(t).length, 0);
  const ticked = Object.values(ticks).reduce((n, l) => n + l.filter(Boolean).length, 0);
  const score = scoreRubric("schrijven", ticked, total);

  // Saving or saved: the checklist is locked, so the stored score is the one on screen.
  const scoreLocked = recordAttempt.isPending || recordAttempt.isSuccess;
  const save = () => {
    recordAttempt.mutate(
      {
        part: "schrijven",
        mode,
        setId,
        correct: score.correct,
        total: score.total,
        passMark: score.passMark,
        durationMs: took,
        missed: tasks.flatMap((t) =>
          checklist(t)
            .map((_, i) => (ticks[t.id]?.[i] ? null : `${t.id}#${i}`))
            .filter((x): x is string => x !== null),
        ),
      },
      // Stored: the draft has done its work.
      { onSuccess: () => writeLocalJSON(draftKey, null) },
    );
  };

  return (
    <div className="exam-session" data-mode={mode}>
      <div className="exam-bar" role="region" aria-label="Session">
        <span className="exam-bar-title">{title}</span>
        <span className="exam-bar-progress">{plural(tasks.length, "task")}</span>
        {phase === "write" ? (
          <ExamClock remaining={clock.remaining} elapsed={clock.elapsed} />
        ) : null}
        {phase === "write" ? (
          <Button size="sm" variant="primary" onClick={handIn}>
            {mode === "exam" ? "Hand in" : "Check my answer"}
          </Button>
        ) : null}
      </div>

      {phase === "check" ? (
        <ScoreCard part="schrijven" score={score} mode={mode} unit="checklist points" />
      ) : null}

      {tasks.map((t, n) => (
        <TaskBlock
          key={t.id}
          n={n + 1}
          task={t}
          answer={answers[t.id]!}
          phase={phase}
          ticks={ticks[t.id] ?? []}
          onAnswer={(a) => setAnswers((all) => ({ ...all, [t.id]: a }))}
          checklistLocked={scoreLocked}
          onTicks={(l) => {
            if (!scoreLocked) setTicks((all) => ({ ...all, [t.id]: l }));
          }}
        />
      ))}

      <Dialog
        open={asking || leave.status === "blocked"}
        onOpenChange={(open) => {
          if (!open) stay();
        }}
        title="Leave the timed exam?"
        description="The clock stops and this attempt ends without a score. Your answers stay here as a draft for next time."
      >
        <div className="k-dialog-actions">
          <Button variant="ghost" onClick={stay}>
            Keep writing
          </Button>
          <Button variant="primary" onClick={go}>
            Leave
          </Button>
        </div>
      </Dialog>

      <div className="exam-nav">
        <Button variant="ghost" onClick={onExit}>
          <ArrowLeft size={16} aria-hidden /> Back
        </Button>
        {phase === "write" ? (
          <Button variant="primary" onClick={handIn}>
            {mode === "exam" ? "Hand in" : "Check my answer"}
          </Button>
        ) : (
          <SaveScore attempt={recordAttempt} score={score} onSave={save} />
        )}
      </div>
    </div>
  );
}

function TaskBlock({
  n,
  task,
  answer,
  phase,
  ticks,
  checklistLocked,
  onAnswer,
  onTicks,
}: {
  n: number;
  task: WritingTask;
  answer: Answer;
  phase: "write" | "check";
  ticks: boolean[];
  checklistLocked: boolean;
  onAnswer: (a: Answer) => void;
  onTicks: (t: boolean[]) => void;
}) {
  const services = useServices();
  const status = useQuery({ queryKey: ["ai-status"], queryFn: () => services.aiStatus() });
  const [feedback, setFeedback] = useState<ExamFeedback | null>(null);
  const list = checklist(task);
  const words = countAnswerWords(answer.text);
  const ai = useMutation({
    mutationFn: () =>
      services.examFeedback({
        part: "schrijven",
        task: `${task.title}. ${task.situation}`,
        points: task.points,
        answer: answerText(task, answer),
        ...(task.minWords ? { minWords: task.minWords } : {}),
      }),
    onSuccess: (f) => {
      setFeedback(f);
      onTicks(
        list.map((_, i) =>
          i < task.points.length ? (f.points[i]?.ok ?? false) : (ticks[i] ?? false),
        ),
      );
    },
  });
  const locked = phase === "check";

  return (
    <section className="exam-task" aria-labelledby={`${task.id}-h`}>
      <p className="exam-eyebrow">Task {n}</p>
      <h2 id={`${task.id}-h`} lang="nl">
        {task.title}
      </h2>
      <p className="exam-task-situation" lang="nl">
        {task.situation}
      </p>
      {task.kind !== "form" ? (
        <ul className="exam-task-points" lang="nl">
          {task.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}

      {task.kind === "form" ? (
        <div className="exam-form" lang="nl">
          {(task.fields ?? []).map((f, i) =>
            f.sentence ? (
              <Textarea
                key={f.label}
                label={f.label}
                rows={3}
                value={answer.fields[i] ?? ""}
                readOnly={locked}
                onChange={(e) => {
                  const fields = [...answer.fields];
                  fields[i] = e.target.value;
                  onAnswer({ ...answer, fields });
                }}
              />
            ) : (
              <Input
                key={f.label}
                label={f.label}
                value={answer.fields[i] ?? ""}
                readOnly={locked}
                onChange={(e) => {
                  const fields = [...answer.fields];
                  fields[i] = e.target.value;
                  onAnswer({ ...answer, fields });
                }}
              />
            ),
          )}
        </div>
      ) : (
        <>
          <Textarea
            label="Your text"
            rows={7}
            lang="nl"
            spellCheck={false}
            value={answer.text}
            readOnly={locked}
            onChange={(e) => onAnswer({ ...answer, text: e.target.value })}
          />
          <p
            className="exam-muted exam-wordcount"
            data-short={words < (task.minWords ?? 0) || undefined}
          >
            {plural(words, "word")}
            {task.minWords ? ` · at least ${task.minWords}` : ""}
          </p>
        </>
      )}

      {locked ? (
        <div className="exam-check">
          <fieldset className="exam-checklist">
            <legend>Check your answer</legend>
            {list.map((item, i) => (
              <label key={i} className="exam-check-item">
                <input
                  type="checkbox"
                  checked={ticks[i] ?? false}
                  disabled={checklistLocked}
                  onChange={(e) => {
                    const next = list.map((_, k) => ticks[k] ?? false);
                    next[i] = e.target.checked;
                    onTicks(next);
                  }}
                />
                <span lang="nl">{item}</span>
              </label>
            ))}
          </fieldset>

          <details className="exam-model" open>
            <summary>Model answer</summary>
            {task.kind === "form" ? (
              <dl className="exam-model-form" lang="nl">
                {(task.fields ?? []).map((f) => (
                  <div key={f.label}>
                    <dt>{f.label}</dt>
                    <dd>{f.model}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="exam-paper-body" lang="nl">
                {task.model}
              </p>
            )}
          </details>

          <GrammarLinks ids={task.grammar} />

          {status.data?.configured ? (
            <div className="exam-ai">
              <Button size="sm" onClick={() => ai.mutate()} disabled={ai.isPending}>
                <Sparkles size={14} aria-hidden />{" "}
                {ai.isPending ? "Asking…" : feedback ? "Ask again" : "Get AI feedback"}
              </Button>
              {ai.isError ? (
                <p className="exam-error" role="alert">
                  {errorText(ai.error)}
                </p>
              ) : null}
              {feedback ? <FeedbackView feedback={feedback} /> : null}
            </div>
          ) : (
            <p className="exam-muted">
              With an AI provider set up in Settings you can also get examiner-style feedback here.
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}

export function FeedbackView({ feedback }: { feedback: ExamFeedback }) {
  return (
    <div className="exam-feedback" aria-label="AI feedback">
      <p>{feedback.summary}</p>
      {feedback.points.length ? (
        <ul className="exam-feedback-points">
          {feedback.points.map((p) => (
            <li key={p.point} data-ok={p.ok || undefined}>
              <span lang="nl">{p.point}</span> — {p.ok ? "done" : "missing"}
              {p.note ? <span className="exam-muted">: {p.note}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {feedback.corrections.length ? (
        <ul className="exam-corrections">
          {feedback.corrections.map((c, i) => (
            <li key={i}>
              <s lang="nl">{c.wrong}</s> → <strong lang="nl">{c.right}</strong>{" "}
              <span className="exam-muted">{c.why}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {feedback.improved ? (
        <details>
          <summary>Corrected version</summary>
          <p className="exam-paper-body" lang="nl">
            {feedback.improved}
          </p>
        </details>
      ) : null}
    </div>
  );
}
