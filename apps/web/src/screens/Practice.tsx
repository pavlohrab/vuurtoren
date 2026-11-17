import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { Exercise, ExerciseKind, Skill } from "@app/core";
import { grammarTopic } from "@app/content";
import {
  Button,
  Chip,
  ExerciseCard,
  ExerciseProgress,
  type ExerciseFeedback,
  type ExerciseSubmit,
  Skeleton,
  shortcutBlocked,
} from "@app/ui";
import { dutchVoiceAvailable, speakDutch } from "../practice/speech.js";
import { useServices } from "../services/context.js";
import type { AISentenceReport } from "../services/aiTypes.js";
import type { AnswerResult } from "../services/types.js";
import { usePageHeader } from "../shell/ShellContext.js";
import { useAIReady } from "./StoryDialog.js";

export const SKILLS: { skill: Skill; label: string }[] = [
  { skill: "recognition", label: "Recognition" },
  { skill: "recall", label: "Recall" },
  { skill: "form", label: "Forms" },
  { skill: "gender", label: "Gender" },
  { skill: "listening", label: "Listening" },
];
const SIZES = [10, 20, 30];

/** One line about what "Fill gaps with AI sentences" did, or null when there is nothing to say. */
export function aiReportText(r: AISentenceReport | null): string | null {
  if (!r) return null;
  if (r.error) return `AI sentences unavailable: ${r.error}`;
  const parts: string[] = [];
  if (r.accepted > 0) {
    parts.push(
      `${r.accepted} new AI ${r.accepted === 1 ? "sentence" : "sentences"} for ${r.requested} ${r.requested === 1 ? "item" : "items"}`,
    );
  }
  if (r.rejected > 0) parts.push(`${r.rejected} rejected by the checks`);
  if (r.reused > 0 && r.accepted === 0) parts.push(`earlier AI sentences used for ${r.reused}`);
  return parts.length ? parts.join(" · ") : null;
}

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

  const [aiReport, setAIReport] = useState<AISentenceReport | null>(null);

  const start = async (size: number, skills: Skill[], aiSentences: boolean) => {
    setError(null);
    setAIReport(null);
    setPhase({ name: "loading" });
    try {
      const exercises = await services.startPractice({
        size,
        skills,
        ...(aiSentences ? { aiSentences, onAISentences: setAIReport } : {}),
      });
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
        <>
          {aiReportText(aiReport) ? (
            <p className="k-hint practice-note" role="status">
              {aiReportText(aiReport)}
            </p>
          ) : null}
          <Session exercises={phase.exercises} listening={phase.listening} onFinish={finish} />
        </>
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
  onStart: (size: number, skills: Skill[], aiSentences: boolean) => void;
}) {
  const services = useServices();
  const aiReady = useAIReady();
  const [aiFill, setAIFill] = useState(true);
  const overview = useQuery({
    queryKey: ["practice", "overview"],
    queryFn: () => services.practiceOverview(),
  });
  const voice = useQuery({
    queryKey: ["practice", "voice"],
    queryFn: () => dutchVoiceAvailable(),
    staleTime: Infinity,
  });
  const [skills, setSkills] = useState<Skill[]>(SKILLS.map((s) => s.skill));
  const [size, setSize] = useState(20);
  const o = overview.data;
  // Listening needs a Dutch voice; while the check runs it stays available.
  const noVoice = voice.data === false;
  const effective = skills.filter((s) => !(s === "listening" && noVoice));

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
      {o?.degraded ? (
        <p className="k-hint practice-note">
          The language server is unreachable — fewer exercise types today
        </p>
      ) : null}

      <fieldset className="practice-group">
        <legend className="k-label">Skills</legend>
        <div className="practice-options">
          {SKILLS.map(({ skill, label }) => {
            const blocked = skill === "listening" && noVoice;
            return (
              <button
                key={skill}
                type="button"
                className="practice-option"
                aria-pressed={!blocked && skills.includes(skill)}
                disabled={blocked}
                title={blocked ? "No Dutch voice is available in this browser" : undefined}
                onClick={() => toggle(skill)}
              >
                {label}
              </button>
            );
          })}
        </div>
        {noVoice ? (
          <p className="k-hint practice-note">
            Listening is off: no Dutch voice is available in this browser.
          </p>
        ) : null}
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

      {aiReady ? (
        <fieldset className="practice-group">
          <legend className="k-label">Sentences</legend>
          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" checked={aiFill} onChange={(e) => setAIFill(e.target.checked)} />
            Fill gaps with AI sentences
          </label>
          <p className="k-hint practice-note">
            Words with fewer than 3 example sentences get checked AI sentences (at most 8 words per
            session, saved for next time).
          </p>
        </fieldset>
      ) : null}

      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      <Button
        variant="primary"
        disabled={loading || effective.length === 0}
        onClick={() => onStart(size, effective, aiReady && aiFill)}
      >
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
  const [feedback, setFeedback] = useState<ExerciseFeedback | null>(null);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shownAt = useRef(0);
  const skippedAt = useRef(-1);
  const current = exercises[index];
  const skipDictation = current?.kind === "dictation" && !listening;

  // Synchronously updated mirrors of the state, so Escape and the end button see an answer
  // that is still being saved.
  const answeredRef = useRef<Answered[]>([]);
  const skippedRef = useRef(0);
  const inflight = useRef<Promise<void> | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);

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
    skippedRef.current += 1;
    advance(answeredRef.current, skippedRef.current);
  }, [skipDictation, advance, index]);

  useEffect(() => {
    shownAt.current = Date.now();
  }, [index]);

  /** End now: wait for an answer that is being saved, so it is part of the summary. */
  const endSession = useCallback(async () => {
    await inflight.current;
    onFinish(answeredRef.current, skippedRef.current);
  }, [onFinish]);

  /** Esc / End button: ask first when something was answered, else end straight away. */
  const requestEnd = useCallback(() => {
    if (answeredRef.current.length > 0 || inflight.current) setConfirmEnd(true);
    else void endSession();
  }, [endSession]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || shortcutBlocked(e)) return;
      e.preventDefault();
      if (confirmEnd) setConfirmEnd(false);
      else requestEnd();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [confirmEnd, requestEnd]);

  const submit = async (s: ExerciseSubmit) => {
    if (!current || busy || feedback) return;
    setBusy(true);
    setError(null);
    const run = (async () => {
      try {
        const result = await services.answerExercise(current, {
          exerciseId: current.id,
          answer: s.answer,
          hintsUsed: s.hintsUsed,
          ms: Date.now() - shownAt.current,
        });
        answeredRef.current = [...answeredRef.current, { exercise: current, result }];
        setSubmitted(s.answer);
        setFeedback({ correct: result.correct, ...(result.note ? { note: result.note } : {}) });
      } catch (e) {
        setError(e instanceof Error ? e.message : "The answer could not be saved. Try again.");
      } finally {
        setBusy(false);
        inflight.current = null;
      }
    })();
    inflight.current = run;
    await run;
  };

  if (!current || skipDictation) return null;
  const last = index === exercises.length - 1;
  return (
    <>
      <div className="practice-top">
        <span className="k-hint">
          {index + 1} of {exercises.length}
        </span>
        <Button variant="ghost" size="sm" onClick={requestEnd}>
          End session <kbd className="ex-key">Esc</kbd>
        </Button>
      </div>
      {confirmEnd ? (
        <p className="practice-confirm" role="group" aria-label="End the session?">
          End the session? Your answers so far are saved.{" "}
          <Button size="sm" variant="primary" onClick={() => void endSession()}>
            End session
          </Button>{" "}
          <Button size="sm" variant="ghost" onClick={() => setConfirmEnd(false)}>
            Keep going
          </Button>
        </p>
      ) : null}
      <ExerciseProgress done={index + (feedback ? 1 : 0)} total={exercises.length} />
      <div className="practice-card">
        <ExerciseCard
          key={current.id}
          exercise={current}
          feedback={feedback}
          submitted={submitted}
          onSubmit={(s) => void submit(s)}
          onContinue={() => advance(answeredRef.current, skippedRef.current)}
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
  emptyTitle = "Practice",
  emptyText = "Nothing to practise yet. Sync Anki in Settings, or read a text and start learning a few words.",
  actions,
}: {
  answered: Answered[];
  skipped: number;
  empty: boolean;
  onAgain: () => void;
  emptyTitle?: string;
  emptyText?: string;
  /** Replaces the default buttons (Practice again, Words). */
  actions?: ReactNode;
}) {
  if (empty) {
    return (
      <>
        <h1>{emptyTitle}</h1>
        <p className="page-lede">{emptyText}</p>
        {actions ?? <Button onClick={onAgain}>Back</Button>}
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
      {actions ?? (
        <div className="practice-actions">
          <Button variant="primary" onClick={onAgain}>
            Practice again
          </Button>
          <Link to="/words" className="k-btn k-btn--secondary">
            Words
          </Link>
        </div>
      )}
    </>
  );
}

/** Route component for /grammar/$topic/practice. */
export function TopicPracticeRoute() {
  const { topic } = useParams({ from: "/grammar/$topic/practice" });
  return <TopicPractice key={topic} topicId={topic} />;
}

const TOPIC_SESSION = 10;

/**
 * Topic exercises: starts straight away with exercises of the topic's kinds, built only from
 * sentences in which the topic was detected (your texts first, then Tatoeba).
 */
export function TopicPractice({ topicId }: { topicId: string }) {
  const services = useServices();
  const client = useQueryClient();
  const topic = grammarTopic(topicId);
  usePageHeader(topic ? `Practise: ${topic.title}` : "Practice");
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState(0);
  const [aiReport, setAIReport] = useState<AISentenceReport | null>(null);
  const aiStatus = useQuery({ queryKey: ["ai-status"], queryFn: () => services.aiStatus() });
  const aiKnown = aiStatus.isFetched || aiStatus.isError;
  const aiOn = aiStatus.data?.configured === true;
  const again = () => {
    setError(null);
    setAIReport(null);
    setPhase({ name: "loading" });
    setRun((n) => n + 1);
  };

  useEffect(() => {
    // Wait for the AI status so a topic with few hits can get AI sentences.
    if (!topic || !aiKnown) return;
    let cancelled = false;
    services
      .startTopicPractice({
        detects: topic.detects,
        kinds: topic.practice as ExerciseKind[],
        size: TOPIC_SESSION,
        topicId: topic.id,
        ...(aiOn ? { aiSentences: true, onAISentences: setAIReport } : {}),
      })
      .then((exercises) => {
        if (cancelled) return;
        setPhase(
          exercises.length
            ? { name: "session", exercises, listening: true }
            : { name: "summary", answered: [], skipped: 0, empty: true },
        );
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setPhase({ name: "start" });
      });
    return () => {
      cancelled = true;
    };
    // Bumping `run` starts a fresh session.
  }, [services, topic, run, aiKnown, aiOn]);

  if (!topic) {
    return (
      <div className="page page--narrow practice">
        <h1>Practice</h1>
        <p className="page-lede">This grammar topic was not found.</p>
        <Link to="/grammar" className="k-btn k-btn--secondary">
          All grammar topics
        </Link>
      </div>
    );
  }
  const back = (
    <div className="practice-actions">
      <Button variant="primary" onClick={again}>
        Practise again
      </Button>
      <Link to="/grammar/$topic" params={{ topic: topic.id }} className="k-btn k-btn--secondary">
        Back to {topic.title}
      </Link>
    </div>
  );
  return (
    <div className="page page--narrow practice">
      {phase.name === "loading" || phase.name === "start" ? (
        <>
          <h1>Practise: {topic.title}</h1>
          <p className="page-lede">{error ? "The session could not be prepared." : "Preparing…"}</p>
          {error ? (
            <>
              <p className="error-text" role="alert">
                {error}
              </p>
              {back}
            </>
          ) : (
            <Skeleton style={{ height: 160, width: "100%", borderRadius: 10 }} />
          )}
        </>
      ) : phase.name === "session" ? (
        <>
          {aiReportText(aiReport) ? (
            <p className="k-hint practice-note" role="status">
              {aiReportText(aiReport)}
            </p>
          ) : null}
          <Session
            exercises={phase.exercises}
            listening={phase.listening}
            onFinish={(answered, skipped) => {
              void client.invalidateQueries({ queryKey: ["practice"] });
              setPhase({ name: "summary", answered, skipped, empty: false });
            }}
          />
        </>
      ) : (
        <Summary
          answered={phase.answered}
          skipped={phase.skipped}
          empty={phase.empty}
          onAgain={again}
          emptyTitle={`Practise: ${topic.title}`}
          emptyText="There are no sentences with this topic to practise yet. Read a text that uses it, or try again when the language server is reachable."
          actions={back}
        />
      )}
    </div>
  );
}
