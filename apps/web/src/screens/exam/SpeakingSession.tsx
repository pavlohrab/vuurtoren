/**
 * Spreken: a situation, a question and a timer per prompt, as on the exam computer. Answers are
 * recorded with MediaRecorder when the browser allows it and kept in memory only (playback for
 * self-review; gone when you leave). Then a self-check against the model answer; optional AI
 * feedback on a typed transcript.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Mic, Sparkles, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type SpeakingPrompt, examBank, scoreRubric } from "@app/content";
import { Button, Textarea } from "@app/ui";
import { useServices } from "../../services/context.js";
import type { ExamFeedback } from "../../services/examTypes.js";
import { errorText } from "../../services/errors.js";
import { type Recording, recordingSupported, startRecording } from "../../exam/recorder.js";
import { formatClock, useExamClock } from "../../exam/timer.js";
import { GrammarLinks, ScoreCard, useRecordAttempt } from "./shared.js";
import { FeedbackView } from "./WritingSession.js";

function speakingChecklist(p: SpeakingPrompt): string[] {
  return [...p.points, ...examBank().spreken.rubric];
}

export function SpeakingSession({
  mode,
  prompts,
  setId,
  title,
  onExit,
}: {
  mode: "exam" | "practice";
  prompts: SpeakingPrompt[];
  setId: string;
  title: string;
  onExit: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [audio, setAudio] = useState<Record<string, string>>({});
  const [ticks, setTicks] = useState<Record<string, boolean[]>>({});
  const [record, setRecord] = useState(recordingSupported());
  const [review, setReview] = useState(false);
  const [saved, setSaved] = useState(false);
  const [startedAt] = useState(() => Date.now());
  const recordAttempt = useRecordAttempt();
  const urls = useRef<string[]>([]);

  // Audio lives only in memory: release it when the session ends.
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const prompt = prompts[index];
  const finishPrompt = (id: string, blob: Blob | null) => {
    setDone((d) => ({ ...d, [id]: true }));
    if (blob && blob.size > 0) {
      const url = URL.createObjectURL(blob);
      urls.current.push(url);
      setAudio((a) => ({ ...a, [id]: url }));
    }
    // Exam mode moves on by itself, like the exam computer.
    if (mode === "exam") {
      if (index < prompts.length - 1) setIndex((i) => i + 1);
      else setReview(true);
    }
  };

  const total = prompts.reduce((n, p) => n + speakingChecklist(p).length, 0);
  const ticked = Object.values(ticks).reduce((n, l) => n + l.filter(Boolean).length, 0);
  const score = scoreRubric("spreken", ticked, total);
  const save = () => {
    setSaved(true);
    recordAttempt.mutate({
      part: "spreken",
      mode,
      setId,
      correct: score.correct,
      total: score.total,
      passMark: score.passMark,
      durationMs: Date.now() - startedAt,
    });
  };

  const bar = (
    <div className="exam-bar" role="region" aria-label="Session">
      <span className="exam-bar-title">{title}</span>
      <span className="exam-bar-progress">
        {review ? "Check your answers" : `Question ${index + 1} of ${prompts.length}`}
      </span>
      {recordingSupported() && !review ? (
        <label className="exam-toggle">
          <input type="checkbox" checked={record} onChange={(e) => setRecord(e.target.checked)} />
          Record my answers
        </label>
      ) : null}
    </div>
  );

  if (review || !prompt) {
    return (
      <div className="exam-session" data-mode={mode}>
        {bar}
        <ScoreCard part="spreken" score={score} mode={mode} unit="checklist points" />
        {prompts.map((p, n) => (
          <PromptReview
            key={p.id}
            n={n + 1}
            prompt={p}
            audio={audio[p.id]}
            ticks={ticks[p.id] ?? []}
            onTicks={(l) => setTicks((t) => ({ ...t, [p.id]: l }))}
          />
        ))}
        <div className="exam-nav">
          <Button variant="ghost" onClick={onExit}>
            <ArrowLeft size={16} aria-hidden /> Back
          </Button>
          {saved ? (
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

  return (
    <div className="exam-session" data-mode={mode}>
      {bar}
      <PromptRunner
        key={prompt.id}
        n={index + 1}
        prompt={prompt}
        record={record}
        onDone={(blob) => finishPrompt(prompt.id, blob)}
      />
      {mode === "practice" && done[prompt.id] ? (
        <PromptReview
          n={index + 1}
          prompt={prompt}
          audio={audio[prompt.id]}
          ticks={ticks[prompt.id] ?? []}
          onTicks={(l) => setTicks((t) => ({ ...t, [prompt.id]: l }))}
          hideQuestion
        />
      ) : null}
      {mode === "practice" ? (
        <div className="exam-nav">
          <Button variant="ghost" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>
            <ArrowLeft size={16} aria-hidden /> Previous
          </Button>
          {index < prompts.length - 1 ? (
            <Button
              variant={done[prompt.id] ? "primary" : "secondary"}
              onClick={() => setIndex((i) => i + 1)}
            >
              Next <ArrowRight size={16} aria-hidden />
            </Button>
          ) : (
            <Button variant="primary" onClick={() => setReview(true)}>
              See results
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** One prompt: read, then answer while the clock runs (and the microphone records). */
function PromptRunner({
  n,
  prompt,
  record,
  onDone,
}: {
  n: number;
  prompt: SpeakingPrompt;
  record: boolean;
  onDone: (blob: Blob | null) => void;
}) {
  const [phase, setPhase] = useState<"ready" | "answering" | "done">("ready");
  const [micError, setMicError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const rec = useRef<Recording | null>(null);
  const clock = useExamClock(prompt.seconds * 1000, phase === "answering", () => void stop());

  useEffect(
    () => () => {
      void rec.current?.stop();
    },
    [],
  );

  async function start() {
    setMicError(null);
    if (record) {
      try {
        rec.current = await startRecording();
        setRecording(true);
      } catch {
        setMicError("The microphone is not available. Answer aloud anyway; nothing is recorded.");
      }
    }
    setPhase("answering");
  }

  async function stop() {
    if (phase === "done") return;
    setPhase("done");
    const blob = rec.current ? await rec.current.stop() : null;
    rec.current = null;
    setRecording(false);
    onDone(blob);
  }

  const left = clock.remaining ?? 0;
  return (
    <section className="exam-prompt" aria-labelledby={`${prompt.id}-h`}>
      <p className="exam-eyebrow">Question {n}</p>
      <p className="exam-task-situation" lang="nl">
        {prompt.situation}
      </p>
      <h2 id={`${prompt.id}-h`} className="exam-prompt-q" lang="nl">
        {prompt.question}
      </h2>
      <div className="exam-prompt-controls">
        {phase === "ready" ? (
          <Button variant="primary" onClick={() => void start()}>
            <Mic size={16} aria-hidden /> Start answering ({prompt.seconds} s)
          </Button>
        ) : phase === "answering" ? (
          <>
            <span className="exam-clock" data-low={left < 10_000 || undefined} role="timer">
              {formatClock(left)}
            </span>
            <span className="exam-rec" aria-live="polite">
              {recording ? "Recording…" : "Speak now"}
            </span>
            <Button onClick={() => void stop()}>
              <Square size={14} aria-hidden /> I'm done
            </Button>
          </>
        ) : (
          <span className="exam-saved">
            <Check size={16} aria-hidden /> Answered
          </span>
        )}
      </div>
      <div
        className="exam-meter"
        aria-hidden
        style={{
          ["--fill" as string]:
            phase === "answering" ? `${(left / (prompt.seconds * 1000)) * 100}%` : "0%",
        }}
      />
      {micError ? <p className="exam-muted">{micError}</p> : null}
    </section>
  );
}

/** Self-check of one prompt: your recording, the model answer, the checklist and AI feedback. */
function PromptReview({
  n,
  prompt,
  audio,
  ticks,
  onTicks,
  hideQuestion = false,
}: {
  n: number;
  prompt: SpeakingPrompt;
  audio: string | undefined;
  ticks: boolean[];
  onTicks: (t: boolean[]) => void;
  hideQuestion?: boolean;
}) {
  const services = useServices();
  const status = useQuery({ queryKey: ["ai-status"], queryFn: () => services.aiStatus() });
  const [transcript, setTranscript] = useState("");
  const [feedback, setFeedback] = useState<ExamFeedback | null>(null);
  const list = speakingChecklist(prompt);
  const ai = useMutation({
    mutationFn: () =>
      services.examFeedback({
        part: "spreken",
        task: `${prompt.situation} ${prompt.question}`,
        points: prompt.points,
        answer: transcript,
      }),
    onSuccess: (f) => {
      setFeedback(f);
      onTicks(
        list.map((_, i) =>
          i < prompt.points.length ? (f.points[i]?.ok ?? false) : (ticks[i] ?? false),
        ),
      );
    },
  });
  return (
    <section className="exam-task" aria-label={`Check question ${n}`}>
      {hideQuestion ? null : (
        <>
          <p className="exam-eyebrow">Question {n}</p>
          <p className="exam-task-situation" lang="nl">
            {prompt.situation} <strong>{prompt.question}</strong>
          </p>
        </>
      )}
      {audio ? (
        <audio className="exam-audio" controls src={audio} aria-label="Your answer">
          <track kind="captions" />
        </audio>
      ) : (
        <p className="exam-muted">No recording for this answer.</p>
      )}
      <details className="exam-model" open>
        <summary>Model answer</summary>
        <p className="exam-paper-body" lang="nl">
          {prompt.model}
        </p>
      </details>
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
      <GrammarLinks ids={prompt.grammar} />
      {status.data?.configured ? (
        <div className="exam-ai">
          <Textarea
            label="Type what you said (optional, for AI feedback)"
            rows={3}
            lang="nl"
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
          />
          <Button
            size="sm"
            onClick={() => ai.mutate()}
            disabled={ai.isPending || !transcript.trim()}
          >
            <Sparkles size={14} aria-hidden /> {ai.isPending ? "Asking…" : "Get AI feedback"}
          </Button>
          {ai.isError ? (
            <p className="exam-error" role="alert">
              {errorText(ai.error)}
            </p>
          ) : null}
          {feedback ? <FeedbackView feedback={feedback} /> : null}
        </div>
      ) : null}
    </section>
  );
}
