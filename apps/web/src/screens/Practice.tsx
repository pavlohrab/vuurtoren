import { plural } from "../format.js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Dumbbell,
  ListChecks,
  MessagesSquare,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { Exercise, ExerciseKind, Skill } from "@app/core";
import { grammarTopic } from "@app/content";
import {
  Button,
  EmptyState,
  ExerciseCard,
  ExerciseProgress,
  type ExerciseFeedback,
  type ExerciseSubmit,
  Skeleton,
  shortcutBlocked,
  useNativeMode,
} from "@app/ui";
import { dutchVoiceAvailable, speakDutch, useDutchVoice } from "../practice/speech.js";
import { useServices } from "../services/context.js";
import type { AnswerResult } from "../services/types.js";
import { usePageHeader } from "../shell/ShellContext.js";
import { ErrorNotice } from "../shell/ErrorNotice.js";
import { useHoldFreshness } from "../services/freshness.js";
import { errorText } from "../services/errors.js";
import { useAIReady } from "./StoryForm.js";
import { PageHeader } from "../shell/PageHeader.js";
import { writePracticeAgain } from "../lastPractice.js";
import { readLastText } from "../lastText.js";
import { readLocalJSON, writeLocalJSON } from "../storage/local.js";
import { type WordInspectorHandle, useWordInspector } from "./useWordInspector.js";
import { pickContinue } from "./Home.js";

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
  const params: { words?: string; start?: string } = useSearch({ from: "/practice" });
  // "Practise these words" from Words, Words from this text or a summary: only these words.
  const focus = params.words
    ? [
        ...new Set(
          params.words
            .split(",")
            .map((w) => w.trim())
            .filter(Boolean),
        ),
      ]
    : null;
  return (
    <PracticeSession key={params.words ?? ""} focus={focus} autoStart={params.start === "1"} />
  );
}

function PracticeSession({ focus, autoStart }: { focus: string[] | null; autoStart: boolean }) {
  const [phase, setPhase] = useState<Phase>({ name: "start" });
  const [error, setError] = useState<unknown>(null);
  const services = useServices();
  const client = useQueryClient();
  const inspector = useWordInspector("reading");

  const start = async (size: number, skills: Skill[], aiSentences: boolean) => {
    setError(null);
    setPhase({ name: "loading" });
    try {
      const exercises = await services.startPractice({
        size,
        skills,
        ...(focus ? { keys: focus } : {}),
        ...(aiSentences ? { aiSentences } : {}),
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
      setError(e ?? new Error("The session could not be prepared."));
      setPhase({ name: "start" });
    }
  };

  const finish = (answered: Answered[], skipped: number) => {
    void client.invalidateQueries({ queryKey: ["practice"] });
    void client.invalidateQueries({ queryKey: ["activity"] });
    writePracticeAgain(answered.filter((a) => !a.result.correct).map((a) => a.exercise.key));
    setPhase({ name: "summary", answered, skipped, empty: false });
  };

  return (
    <div className="page page--list practice">
      {phase.name === "start" || phase.name === "loading" ? (
        <StartView
          loading={phase.name === "loading"}
          error={error}
          onStart={start}
          focus={focus}
          autoStart={autoStart}
        />
      ) : phase.name === "session" ? (
        <div className="practice-session">
          <Session
            exercises={phase.exercises}
            listening={phase.listening}
            onFinish={finish}
            inspector={inspector}
          />
        </div>
      ) : (
        <Summary
          inspector={inspector}
          answered={phase.answered}
          skipped={phase.skipped}
          empty={phase.empty}
          onAgain={() => setPhase({ name: "start" })}
          {...(focus
            ? {
                emptyTitle: "Nothing to practise for these words",
                emptyText:
                  "Kenning has no example sentences for them yet. Read a text that uses them, or practise the words that are due.",
              }
            : {})}
        />
      )}
      {inspector.portal}
    </div>
  );
}

/** A toggle chip: selected is filled with a check, disabled is muted and announced as such. */
function OptionChip({
  pressed,
  disabled = false,
  title,
  onClick,
  children,
}: {
  pressed: boolean;
  disabled?: boolean;
  title?: string | undefined;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="k-toggle"
      aria-pressed={pressed}
      aria-disabled={disabled || undefined}
      title={title}
      onClick={disabled ? undefined : onClick}
    >
      {pressed ? <Check size={14} aria-hidden /> : null}
      {children}
    </button>
  );
}

/** What Practice is for, in one quiet line (both modes). */
function PracticeNote({ native }: { native: boolean }) {
  return (
    <p className="k-hint practice-about">
      {native
        ? "Practice trains what flashcards don’t: forms, gender, word order and listening."
        : "Practice trains what Anki doesn’t: forms, gender, word order and listening. Your Anki reviews stay in Anki."}{" "}
      Keys: 1–4 to choose, Enter to check and go on, Esc to end.
    </p>
  );
}

const OPTIONS_KEY = "kenning.practice.options";

interface StartOptions {
  skills: Skill[];
  size: number;
  ai: boolean;
}

/** The options last used on this device (all skills, 20 exercises, AI sentences on). */
export function readStartOptions(): StartOptions {
  const fallback: StartOptions = { skills: SKILLS.map((s) => s.skill), size: 20, ai: true };
  const raw = readLocalJSON(OPTIONS_KEY);
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Partial<Record<keyof StartOptions, unknown>>;
  const known = new Set<string>(SKILLS.map((s) => s.skill));
  const skills = Array.isArray(r.skills)
    ? r.skills.filter((x): x is Skill => typeof x === "string" && known.has(x))
    : [];
  return {
    skills: skills.length ? skills : fallback.skills,
    size: typeof r.size === "number" && SIZES.includes(r.size) ? r.size : fallback.size,
    ai: typeof r.ai === "boolean" ? r.ai : fallback.ai,
  };
}

/** One line on the chosen options, shown next to the closed "Options". */
function optionsSummary(skills: Skill[], size: number, ai: boolean): string {
  const names =
    skills.length === SKILLS.length
      ? "All skills"
      : SKILLS.filter((s) => skills.includes(s.skill))
          .map((s) => s.label)
          .join(", ");
  return [names, `${size} exercises`, ...(ai ? ["AI sentences"] : [])].join(" · ");
}

function StartView({
  loading,
  error,
  onStart,
  focus,
  autoStart,
}: {
  loading: boolean;
  error: unknown;
  onStart: (size: number, skills: Skill[], aiSentences: boolean) => void;
  /** Practise only these words. */
  focus: string[] | null;
  /** Start with the remembered options as soon as there is something to practise (?start=1). */
  autoStart: boolean;
}) {
  const services = useServices();
  const navigate = useNavigate();
  const aiReady = useAIReady();
  const [initial] = useState(readStartOptions);
  const [aiFill, setAIFill] = useState(initial.ai);
  const overview = useQuery({
    queryKey: ["practice", "overview"],
    queryFn: () => services.practiceOverview(),
  });
  const review = useQuery({
    queryKey: ["review", "overview"],
    queryFn: () => services.reviewOverview(),
    staleTime: 60_000,
  });
  const voice = useDutchVoice();
  const [skills, setSkills] = useState<Skill[]>(initial.skills);
  const [size, setSize] = useState(initial.size);
  useEffect(() => {
    writeLocalJSON(OPTIONS_KEY, { skills, size, ai: aiFill });
  }, [skills, size, aiFill]);
  const o = overview.data;
  // Listening needs a Dutch voice; while the check runs it stays available.
  const noVoice = voice === false;
  const effective = skills.filter((s) => !(s === "listening" && noVoice));

  // ?start=1 (the command palette's "Start practice"): start once, then drop the flag so
  // "Practise again" from the summary shows this view instead of starting by itself.
  const ready = !!o && voice !== undefined && (o.due > 0 || o.newAvailable > 0 || !!focus);
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoStart || autoStarted.current || !ready || loading || effective.length === 0) return;
    autoStarted.current = true;
    void navigate({
      to: "/practice",
      search: focus ? { words: focus.join(",") } : {},
      replace: true,
    });
    onStart(size, effective, aiReady && aiFill);
  });

  const toggle = (s: Skill) =>
    setSkills((cur) =>
      cur.includes(s) ? (cur.length > 1 ? cur.filter((x) => x !== s) : cur) : [...cur, s],
    );

  // Nothing due and nothing new: no Start button, one next step instead.
  if (o && o.due === 0 && o.newAvailable === 0 && !focus) {
    const fresh = o.learned === 0 && o.lastSession === null;
    return (
      <>
        <PageHeader title="Practice" />
        <EmptyState
          icon={<Dumbbell size={20} />}
          title={fresh ? "Nothing to practise yet" : "All caught up"}
          description={
            fresh
              ? "Exercises come from words you are learning. Read a text and add the words you want to keep."
              : "No exercises are due right now. Read something new and come back later."
          }
          action={
            <Link to="/library" className="k-btn k-btn--primary">
              Go to the Library
            </Link>
          }
        />
      </>
    );
  }

  const go = () => onStart(size, effective, aiReady && aiFill);
  const startLabel = loading
    ? "Preparing…"
    : focus
      ? `Start · ${plural(focus.length, "word")}`
      : o && o.due > 0
        ? `Start · ${o.due} due`
        : o && o.newAvailable > 0
          ? `Start · ${o.newAvailable} new`
          : "Start";

  return (
    <>
      <PageHeader
        title={focus ? "Practise these words" : "Practice"}
        lede={
          focus ? (
            <>
              {plural(focus.length, "word")}: <span lang="nl">{focus.slice(0, 8).join(", ")}</span>
              {focus.length > 8 ? "…" : ""}
            </>
          ) : o ? (
            `${plural(o.due, "exercise")} due · ${o.newAvailable} new`
          ) : (
            "Short exercises from words you are learning."
          )
        }
        actions={
          <>
            {focus ? (
              <Link to="/practice" className="k-btn k-btn--ghost">
                All due exercises
              </Link>
            ) : null}
            <Button
              variant="primary"
              disabled={loading || effective.length === 0 || (!o && !focus)}
              onClick={go}
            >
              {startLabel}
            </Button>
          </>
        }
      />
      <div className="practice-form">
        {o?.degraded ? (
          <p className="k-hint practice-note">
            The language server is unreachable — fewer exercise types today
          </p>
        ) : null}
        {error ? (
          <ErrorNotice error={error} title="The session could not be prepared." onRetry={go} />
        ) : null}
        {noVoice ? (
          <p className="k-hint practice-note" role="note">
            Listening and dictation are off: no Dutch voice is installed. Add one in your system's
            speech settings to practise them.
          </p>
        ) : null}

        <details className="k-disclosure practice-more">
          <summary>
            <ChevronRight size={16} className="k-disclosure-icon" aria-hidden />
            Options
            <span className="k-disclosure-hint">
              {optionsSummary(effective, size, aiReady && aiFill)}
            </span>
          </summary>
          <div className="k-disclosure-body practice-form">
            <fieldset className="practice-group">
              <legend className="k-label">Skills</legend>
              <div className="practice-options">
                {SKILLS.map(({ skill, label }) => {
                  const blocked = skill === "listening" && noVoice;
                  return (
                    <OptionChip
                      key={skill}
                      pressed={!blocked && skills.includes(skill)}
                      disabled={blocked}
                      title={blocked ? "No Dutch voice is available in this browser" : undefined}
                      onClick={() => toggle(skill)}
                    >
                      {label}
                    </OptionChip>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="practice-group">
              <legend className="k-label">Session length</legend>
              <div className="practice-options">
                {SIZES.map((n) => (
                  <OptionChip key={n} pressed={size === n} onClick={() => setSize(n)}>
                    {n} exercises
                  </OptionChip>
                ))}
              </div>
            </fieldset>

            {aiReady ? (
              <fieldset className="practice-group">
                <legend className="k-label">Sentences</legend>
                <label className="row" style={{ gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={aiFill}
                    onChange={(e) => setAIFill(e.target.checked)}
                  />
                  Fill gaps with AI sentences
                </label>
                <p className="k-hint practice-note">
                  Words with only a few example sentences get new ones, checked and kept for next
                  time.
                </p>
              </fieldset>
            ) : null}
          </div>
        </details>
        <PracticeNote native={review.data?.native === true} />
      </div>
    </>
  );
}

function Session({
  exercises,
  listening,
  onFinish,
  inspector,
}: {
  exercises: Exercise[];
  listening: boolean;
  onFinish: (answered: Answered[], skipped: number) => void;
  /** After answering, the Dutch answer and sentence open the word inspector. */
  inspector: WordInspectorHandle;
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
  // Another device's changes wait until the session ends.
  useHoldFreshness();

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
        setError(errorText(e, "The answer could not be saved."));
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
          onWord={(form, sentence, el) => inspector.open(form, sentence, el)}
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
  emptyText,
  actions,
  inspector,
}: {
  /** The words to look at again open the word inspector. */
  inspector: WordInspectorHandle;
  answered: Answered[];
  skipped: number;
  empty: boolean;
  onAgain: () => void;
  emptyTitle?: string;
  emptyText?: string;
  /** Replaces the default next steps (Practise again, Review, Talk, Next text). */
  actions?: ReactNode;
}) {
  const native = useNativeMode();
  if (empty) {
    const lede =
      emptyText ??
      (native
        ? "Nothing to practise yet. Read a text and start learning a few words."
        : "Nothing to practise yet. Sync Anki in Settings, or read a text and start learning a few words.");
    return (
      <>
        <PageHeader title={emptyTitle} lede={lede} />
        {actions ?? <Button onClick={onAgain}>Back</Button>}
      </>
    );
  }
  const correct = answered.filter((a) => a.result.correct).length;
  // Counted per word: a word practised in several skills is one word.
  const started = new Set(
    answered.filter((a) => a.result.next.reps === 1).map((a) => a.exercise.key),
  ).size;
  const relearned = new Set(
    answered
      .filter((a) => a.result.grade === "again" && a.result.next.reps > 1)
      .map((a) => a.exercise.key),
  ).size;
  const again = [...new Set(answered.filter((a) => !a.result.correct).map((a) => a.exercise.key))];
  const practised = [...new Set(answered.map((a) => a.exercise.key))];
  return (
    <>
      <PageHeader
        title="Session complete"
        lede={
          answered.length === 0
            ? "No exercises were answered."
            : `${correct} of ${answered.length} correct.`
        }
      />
      <dl className="done-stats">
        <div>
          <dt>Words practised</dt>
          <dd>{practised.length}</dd>
        </div>
        <div>
          <dt>New words started</dt>
          <dd>{started}</dd>
        </div>
        <div>
          <dt>Words to relearn</dt>
          <dd className={relearned ? "done-stats-learn" : undefined}>{relearned}</dd>
        </div>
      </dl>
      {skipped > 0 ? (
        <p className="k-hint practice-note">
          {skipped} listening {skipped === 1 ? "exercise was" : "exercises were"} skipped: no Dutch
          voice is available in this browser.
        </p>
      ) : null}
      {again.length > 0 ? (
        <section className="practice-group">
          <h2 className="k-section-title">Words to look at again</h2>
          <div className="practice-options">
            {again.map((k) => (
              <button
                key={k}
                type="button"
                className="k-word-chip"
                lang="nl"
                aria-pressed={inspector.current === k}
                onClick={(e) => inspector.openKey(k, e.currentTarget)}
              >
                {k}
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {actions ?? <NextSteps onAgain={onAgain} again={again} practised={practised} />}
    </>
  );
}

/** Where to go after a session: every summary leads on (no dead ends). */
function NextSteps({
  onAgain,
  again,
  practised,
}: {
  onAgain: () => void;
  again: string[];
  practised: string[];
}) {
  const services = useServices();
  const texts = useQuery({ queryKey: ["texts"], queryFn: () => services.listTexts() });
  const next = texts.data ? pickContinue(texts.data, readLastText()) : null;
  const talkWords = (again.length ? again : practised).slice(0, 6);
  return (
    <nav className="practice-next" aria-label="Next steps">
      <Button variant="primary" onClick={onAgain}>
        Practise again
      </Button>
      <Link
        to="/words"
        search={again.length ? { source: "practice-again" } : { state: "learning" }}
        className="practice-next-link"
      >
        <ListChecks size={18} aria-hidden />
        <span>
          Review these words
          <small>
            {again.length
              ? `${again.length} to look at again, in Words`
              : "The words you are learning, in Words"}
          </small>
        </span>
        <ArrowRight size={16} aria-hidden />
      </Link>
      <Link
        to="/talk"
        search={talkWords.length ? { words: talkWords.join(",") } : {}}
        className="practice-next-link"
      >
        <MessagesSquare size={18} aria-hidden />
        <span>
          Talk about these words
          <small>A short chat that uses them</small>
        </span>
        <ArrowRight size={16} aria-hidden />
      </Link>
      {next ? (
        <Link to="/read/$textId" params={{ textId: next.text.id }} className="practice-next-link">
          <BookOpen size={18} aria-hidden />
          <span>
            {next.started ? "Continue reading" : "Next text"}
            <small>{next.text.title}</small>
          </span>
          <ArrowRight size={16} aria-hidden />
        </Link>
      ) : (
        <Link to="/library" className="practice-next-link">
          <BookOpen size={18} aria-hidden />
          <span>
            Next text
            <small>Pick something from the Library</small>
          </span>
          <ArrowRight size={16} aria-hidden />
        </Link>
      )}
    </nav>
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
  const inspector = useWordInspector("reading");
  const aiStatus = useQuery({ queryKey: ["ai-status"], queryFn: () => services.aiStatus() });
  const aiKnown = aiStatus.isFetched || aiStatus.isError;
  const aiOn = aiStatus.data?.configured === true;
  const again = () => {
    setError(null);
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
        ...(aiOn ? { aiSentences: true } : {}),
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
        <PageHeader title="Practice" lede="This grammar topic was not found." />
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
          <PageHeader
            title={`Practise: ${topic.title}`}
            lede={error ? "The session could not be prepared." : "Preparing…"}
          />
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
        <Session
          exercises={phase.exercises}
          listening={phase.listening}
          onFinish={(answered, skipped) => {
            void client.invalidateQueries({ queryKey: ["practice"] });
            setPhase({ name: "summary", answered, skipped, empty: false });
          }}
          inspector={inspector}
        />
      ) : (
        <Summary
          inspector={inspector}
          answered={phase.answered}
          skipped={phase.skipped}
          empty={phase.empty}
          onAgain={again}
          emptyTitle={`Practise: ${topic.title}`}
          emptyText="There are no sentences with this topic to practise yet. Read a text that uses it, or try again when the language server is reachable."
          actions={back}
        />
      )}
      {inspector.portal}
    </div>
  );
}
