/**
 * Schrijven: write first (exam mode: all tasks of a set against one clock, like the paper exam),
 * then check each answer with the checklist and the model answer. Optional AI feedback when a
 * provider is configured; the score is what you tick (AI verdicts tick task points for you).
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, Sparkles } from "lucide-react";
import { useState } from "react";
import { type WritingTask, countAnswerWords, examBank, scoreRubric } from "@app/content";
import { Button, Input, Textarea } from "@app/ui";
import { useServices } from "../../services/context.js";
import type { ExamFeedback } from "../../services/examTypes.js";
import { errorText } from "../../services/errors.js";
import { useExamClock } from "../../exam/timer.js";
import { ExamClock, GrammarLinks, ScoreCard, useRecordAttempt } from "./shared.js";

type Answer = { text: string; fields: string[] };

/** Checklist of one task: its own points, then the general rubric of its kind. */
export function checklist(task: WritingTask): string[] {
  const rubric = examBank().schrijven.rubric;
  return [...task.points, ...(task.kind === "form" ? rubric.form : rubric.message)];
}

/** The answer as plain text (forms: "Label: value" lines), for AI feedback. */
export function answerText(task: WritingTask, a: Answer): string {
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
  const [answers, setAnswers] = useState<Record<string, Answer>>(() =>
    Object.fromEntries(
      tasks.map((t) => [t.id, { text: "", fields: (t.fields ?? []).map(() => "") }]),
    ),
  );
  const [phase, setPhase] = useState<"write" | "check">("write");
  const [ticks, setTicks] = useState<Record<string, boolean[]>>({});
  const [saved, setSaved] = useState(false);
  const clock = useExamClock(mode === "exam" ? limitMs : null, phase === "write", () => handIn());
  const [took, setTook] = useState(0);
  const recordAttempt = useRecordAttempt();

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

  const save = () => {
    setSaved(true);
    recordAttempt.mutate({
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
    });
  };

  return (
    <div className="exam-session" data-mode={mode}>
      <div className="exam-bar" role="region" aria-label="Session">
        <span className="exam-bar-title">{title}</span>
        <span className="exam-bar-progress">
          {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
        </span>
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
          onTicks={(l) => setTicks((all) => ({ ...all, [t.id]: l }))}
        />
      ))}

      <div className="exam-nav">
        <Button variant="ghost" onClick={onExit}>
          <ArrowLeft size={16} aria-hidden /> Back
        </Button>
        {phase === "write" ? (
          <Button variant="primary" onClick={handIn}>
            {mode === "exam" ? "Hand in" : "Check my answer"}
          </Button>
        ) : saved ? (
          <span className="exam-saved">
            <Check size={16} aria-hidden /> Result saved
          </span>
        ) : (
          <Button variant="primary" onClick={save}>
            Save my score ({score.correct}/{score.total})
          </Button>
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
  onAnswer,
  onTicks,
}: {
  n: number;
  task: WritingTask;
  answer: Answer;
  phase: "write" | "check";
  ticks: boolean[];
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
            {words} {words === 1 ? "word" : "words"}
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
