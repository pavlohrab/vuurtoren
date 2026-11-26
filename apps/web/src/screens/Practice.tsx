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
  X,
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
import { toWav16k } from "../practice/wav.js";
import { useSay } from "../audio/useSay.js";
import { buzz, moving, play as playSound, useFeel } from "../practice/feel.js";
import { PracticeFeelSettings } from "./settings/PracticeFeelSettings.js";
import { clipId } from "@app/anki";
import {
  androidListen,
  androidListenAvailable,
  androidStopListening,
} from "../platform/androidListen.js";
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
import { pickContinue } from "../textPages.js";
import { WordsRoom } from "./words/WordsRoom.js";
import { useWideDesk } from "./words/WordsHome.js";

export const SKILLS: { skill: Skill; label: string }[] = [
  { skill: "recognition", label: "Recognition" },
  { skill: "recall", label: "Recall" },
  { skill: "form", label: "Forms" },
  { skill: "gender", label: "Gender" },
  { skill: "listening", label: "Listening" },
];
/** Words in a lesson: Short, Normal, Long (algorithms.md 4.7.6). */
const SIZES = [5, 10, 15];

/** One answered exercise of the running session. */
interface Answered {
  exercise: Exercise;
  result: AnswerResult;
}

type Phase =
  | { name: "start" }
  | { name: "loading" }
  | { name: "session"; exercises: Exercise[]; listening: boolean }
  | { name: "summary"; answered: Answered[]; skipped: number; empty: boolean; ms?: number };

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
  const wide = useWideDesk();

  const startedAt = useRef(0);
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
      const listening = exercises.some((e) => e.kind === "dictation" || e.kind === "listen-build")
        ? await dutchVoiceAvailable()
        : true;
      startedAt.current = Date.now();
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
    if (answered.length > 0) countLessonToday();
    setPhase({
      name: "summary",
      answered,
      skipped,
      empty: false,
      ms: Date.now() - startedAt.current,
    });
  };

  return (
    <div className="page page--list practice">
      {/* On a computer Practice has its own sidebar row; the Words bar is for the phone. */}
      {(phase.name === "start" || phase.name === "loading") && !wide ? <WordsRoom /> : null}
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
          {...(phase.ms !== undefined ? { ms: phase.ms } : {})}
          onAgain={() => setPhase({ name: "start" })}
          {...(focus
            ? {
                emptyTitle: "Nothing to practise for these words",
                emptyText:
                  "Vuurtoren has no example sentences for them yet. Read a text that uses them, or practise the words that are due.",
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
      <span className="k-keyhint">Keys: 1–4 to choose, Enter to check and go on, Esc to end.</span>
      <span className="k-touchhint">Tap an answer, then Check.</span>
    </p>
  );
}

const OPTIONS_KEY = "vuurtoren.practice.options";

interface StartOptions {
  skills: Skill[];
  size: number;
  ai: boolean;
}

/** The options last used on this device (all skills, 20 exercises, AI sentences on). */
export function readStartOptions(): StartOptions {
  const fallback: StartOptions = { skills: SKILLS.map((s) => s.skill), size: 10, ai: true };
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
  return [names, `${size} words`, ...(ai ? ["AI sentences"] : [])].join(" · ");
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
  const wide = useWideDesk();
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
  const sources = useQuery({
    queryKey: ["practice", "sources"],
    queryFn: () => services.lessonSources?.(readLastText()) ?? null,
    enabled: !focus,
  });
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

  const src = sources.data;
  const practise = (keys: string[]) =>
    void navigate({ to: "/practice", search: { words: keys.join(","), start: "1" } });
  // Enter starts the first lesson (the main card), as the mock shows on a computer.
  useEffect(() => {
    if (focus) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || shortcutBlocked(e)) return;
      if (e.target instanceof HTMLElement && e.target.closest("button,a,input,summary")) return;
      e.preventDefault();
      if (src?.page) practise(src.page.keys);
      else if (o && (o.due > 0 || o.newAvailable > 0) && !loading)
        onStart(size, effective, aiReady && aiFill);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  // Nothing due, nothing new and no lesson to offer: no Start, one next step instead.
  // (Wait for the lesson list, so a page lesson doesn't flash "All caught up" first.)
  const sourcesKnown = sources.isSuccess || !services.lessonSources;
  if (
    o &&
    o.due === 0 &&
    o.newAvailable === 0 &&
    !focus &&
    sourcesKnown &&
    !src?.page &&
    !src?.mistakes.length
  ) {
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
            <Link to="/" className="k-btn k-btn--primary">
              Find something to read
            </Link>
          }
        />
      </>
    );
  }

  const go = () => onStart(size, effective, aiReady && aiFill);
  const options = (
    <details className="k-disclosure practice-more" open={wide || undefined}>
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
                {n} words
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
              Words with few sentences get new ones from your AI.
            </p>
          </fieldset>
        ) : null}
        {/* How Practice reacts: the same switches as Settings → Your words → Practice (M6). */}
        <PracticeFeelSettings title="Sound and movement" />
      </div>
    </details>
  );
  const startLabel = loading
    ? "Preparing…"
    : focus
      ? `Start · ${plural(focus.length, "word")}`
      : o && o.due > 0
        ? `Start · ${o.due} due`
        : o && o.newAvailable > 0
          ? `Start · ${o.newAvailable} new`
          : "Start";

  if (!focus)
    return (
      <>
        <PageHeader title="Practice" lede={<TodayCount />} />
        <div className="practice-start">
          <div className="practice-form practice-main">
            {o?.degraded ? (
              <p className="k-hint practice-note">
                The language server doesn&rsquo;t answer, so there are fewer kinds of exercise
                today.
              </p>
            ) : null}
            {error ? (
              <ErrorNotice error={error} title="The lesson could not be prepared." onRetry={go} />
            ) : null}
            <div className="lessons" role="group" aria-label="Lessons">
              {src?.page ? (
                <LessonCard
                  main
                  icon={<BookOpen size={18} aria-hidden />}
                  title={src.page.title}
                  sub={`${plural(src.page.keys.length, "word")} you tapped`}
                  words={src.page.keys}
                  onClick={() => practise(src.page!.keys)}
                />
              ) : null}
              {o && (o.due > 0 || o.newAvailable > 0) ? (
                <LessonCard
                  main={!src?.page}
                  icon={<Dumbbell size={18} aria-hidden />}
                  title="Your new words"
                  sub={loading ? "Preparing…" : `${o.due} due · ${o.newAvailable} new`}
                  label={startLabel}
                  disabled={loading || effective.length === 0}
                  onClick={go}
                />
              ) : null}
              {src?.mistakes.length ? (
                <LessonCard
                  icon={<ListChecks size={18} aria-hidden />}
                  title="Mistakes"
                  sub={`${plural(src.mistakes.length, "word")} you got wrong this week`}
                  onClick={() => practise(src.mistakes)}
                />
              ) : null}
              {src?.weak && grammarTopic(src.weak.topic) ? (
                <LessonCard
                  icon={<MessagesSquare size={18} aria-hidden />}
                  title={grammarTopic(src.weak.topic)!.title}
                  sub={`${plural(src.weak.misses, "miss", "misses")} this week`}
                  onClick={() =>
                    void navigate({
                      to: "/grammar/$topic/practice",
                      params: { topic: src.weak!.topic },
                    })
                  }
                />
              ) : null}
            </div>
            {noVoice ? (
              <p className="k-hint practice-note" role="note">
                Add a Dutch voice in your system&rsquo;s settings to practise listening and
                dictation.
              </p>
            ) : null}
            {wide ? null : options}
            <PracticeNote native={review.data?.native === true} />
          </div>
          {wide ? (
            <aside className="practice-aside" aria-label="About your practice">
              {src?.tomorrow.length ? (
                <section className="practice-box">
                  <h2 className="practice-box-h">Back tomorrow</h2>
                  <div className="lesson-chips" lang="nl">
                    {src.tomorrow.slice(0, 8).map((k) => (
                      <span key={k} className="lesson-chip">
                        {k}
                      </span>
                    ))}
                    {src.tomorrow.length > 8 ? (
                      <span className="lesson-chip">+{src.tomorrow.length - 8}</span>
                    ) : null}
                  </div>
                </section>
              ) : null}
              <section className="practice-box">{options}</section>
              <section className="practice-box">
                <h2 className="practice-box-h">Keys in a lesson</h2>
                <dl className="practice-keys">
                  <dt>
                    <kbd className="ex-key">1</kbd>–<kbd className="ex-key">9</kbd>
                  </dt>
                  <dd>pick an answer or a tile</dd>
                  <dt>
                    <kbd className="ex-key">Enter</kbd>
                  </dt>
                  <dd>check, then go on</dd>
                  <dt>
                    <kbd className="ex-key">Space</kbd>
                  </dt>
                  <dd>hear the Dutch again</dd>
                  <dt>
                    <kbd className="ex-key">?</kbd>
                  </dt>
                  <dd>a hint</dd>
                  <dt>
                    <kbd className="ex-key">⌫</kbd>
                  </dt>
                  <dd>take back the last tile</dd>
                  <dt>
                    <kbd className="ex-key">Esc</kbd>
                  </dt>
                  <dd>stop the lesson</dd>
                </dl>
              </section>
            </aside>
          ) : null}
        </div>
      </>
    );

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
            The language server doesn&rsquo;t answer, so there are fewer kinds of exercise today.
          </p>
        ) : null}
        {error ? (
          <ErrorNotice error={error} title="The session could not be prepared." onRetry={go} />
        ) : null}
        {noVoice ? (
          <p className="k-hint practice-note" role="note">
            Add a Dutch voice in your system&rsquo;s settings to practise listening and dictation.
          </p>
        ) : null}

        {options}
        <PracticeNote native={review.data?.native === true} />
      </div>
    </>
  );
}

function Session({
  exercises: planned,
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
  const navigate = useNavigate();
  // On the phone, its own recogniser hears "Say this sentence" (no server needed).
  const phoneListens = useQuery({
    queryKey: ["android-listen"],
    queryFn: androidListenAvailable,
    staleTime: Infinity,
  }).data;
  // The recorded clip when the audio pack has one (starter words, their sentences, stories),
  // else the voice. A rate below 0.9 is the snail: slower than the Settings speed.
  const { play } = useSay();
  const speak = useCallback(
    (text: string, rate?: number) =>
      void (async () => {
        const kind = /\s/.test(text.trim()) ? "sentence" : "word";
        await play("practice", { clip: await clipId(kind, text), text }, rate ? rate / 0.9 : 1);
      })().catch(() => speakDutch(text, rate)),
    [play],
  );
  const feel = useFeel();
  /** Exercises tried again after a miss (Say this sentence). */
  const retried = useRef(new Set<string>());
  /** Exercises the learner said were heard wrong: their second go is not added. */
  const saidRightIds = useRef(new Set<string>());
  // The lesson grows by a missed word's second go at the end (algorithms.md 4.7.6).
  const [exercises, setExercises] = useState(planned);
  const [index, setIndex] = useState(0);
  const [feedback, setFeedback] = useState<ExerciseFeedback | null>(null);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shownAt = useRef(0);
  const skippedAt = useRef(-1);
  const current = exercises[index];
  const skipDictation =
    (current?.kind === "dictation" || current?.kind === "listen-build") && !listening;
  // Another device's changes wait until the session ends.
  useHoldFreshness();

  // Synchronously updated mirrors of the state, so Escape and the end button see an answer
  // that is still being saved.
  const answeredRef = useRef<Answered[]>([]);
  const skippedRef = useRef(0);
  const inflight = useRef<Promise<void> | null>(null);
  /** The lesson ended normally (finished, or ended with Esc / End session). */
  const ended = useRef(false);
  const [confirmEnd, setConfirmEnd] = useState(false);

  const advance = useCallback(
    (nextAnswered: Answered[], nextSkipped: number) => {
      if (index + 1 >= exercises.length) {
        ended.current = true;
        onFinish(nextAnswered, nextSkipped);
      } else {
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

  // Leaving by the sidebar (or closing the app) after three answers still counts the lesson
  // for today; ending it normally counts it in `finish`.
  useEffect(
    () => () => {
      if (!ended.current && answeredRef.current.length >= LEAVE_COUNTS) countLessonToday();
    },
    [],
  );

  /** End now: wait for an answer that is being saved, so it is part of the summary. */
  const endSession = useCallback(async () => {
    ended.current = true;
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
        // A retry replaces the earlier miss in the summary; right now means no second go.
        answeredRef.current = [
          ...answeredRef.current.filter(
            (a) => !(retried.current.has(current.id) && a.exercise.id === current.id),
          ),
          { exercise: current, result },
        ];
        if (result.correct && retried.current.has(current.id))
          setExercises((xs) =>
            xs.filter((x, i) => i <= index || !(x.key === current.key && x.id.endsWith("-again"))),
          );
        // One second go per word: not again after a retry, and not for a second go itself.
        if (!result.correct && !current.id.endsWith("-again") && !retried.current.has(current.id)) {
          const again = await services.comeBack?.(current).catch(() => null);
          if (again && !saidRightIds.current.has(current.id))
            setExercises((xs) => (xs.some((x) => x.id === again.id) ? xs : [...xs, again]));
        }
        setSubmitted(s.answer);
        setFeedback({ correct: result.correct, ...(result.note ? { note: result.note } : {}) });
        playSound(result.correct ? "right" : "wrong", feel);
        if (!result.correct) buzz(feel);
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

  /**
   * The recogniser misheard "Say this sentence": save it again as right, show it as right, and
   * take back the second go that the miss added.
   */
  const saidRight = async () => {
    if (!current || busy) return;
    saidRightIds.current.add(current.id);
    setBusy(true);
    try {
      const result = await services.answerExercise(current, {
        exerciseId: current.id,
        answer: current.answer,
        hintsUsed: 0,
        ms: Date.now() - shownAt.current,
      });
      answeredRef.current = [
        ...answeredRef.current.filter((a) => a.exercise.id !== current.id),
        { exercise: current, result },
      ];
      setExercises((xs) =>
        xs.filter((x, i) => i <= index || !(x.key === current.key && x.id.endsWith("-again"))),
      );
      setFeedback({ correct: true });
    } catch (e) {
      setError(errorText(e, "The answer could not be saved."));
    } finally {
      setBusy(false);
    }
  };

  /** "Try again" after a miss on "Say this sentence": the same sentence, the mic again. A
   * right answer then takes back the second go the miss added. */
  const tryAgain = () => {
    if (!current) return;
    retried.current.add(current.id);
    setFeedback(null);
    setSubmitted(null);
    shownAt.current = Date.now();
  };

  /** "I can't talk now": no more speaking in this lesson; this one goes by unanswered. */
  const skipSpeaking = () => {
    setExercises((xs) => xs.filter((x, i) => i <= index || x.kind !== "say"));
    advance(answeredRef.current, skippedRef.current);
  };

  if (!current || skipDictation) return null;
  const last = index === exercises.length - 1;
  // After a miss, a link to the grammar page (the answers so far are already saved).
  const page = current.topic ? grammarTopic(current.topic) : undefined;
  const topic = page
    ? {
        title: page.title,
        onOpen: () => void navigate({ to: "/grammar/$topic", params: { topic: page.id } }),
      }
    : undefined;
  return (
    <>
      <div className="practice-top">
        <button
          type="button"
          className="practice-close"
          onClick={requestEnd}
          aria-label="End session"
          title="End session (Esc)"
        >
          <X size={20} aria-hidden />
        </button>
        <ExerciseProgress done={index + (feedback ? 1 : 0)} total={exercises.length} />
        <span className="practice-count">
          {index + 1} of {exercises.length}
        </span>
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
      <div className={`practice-card${moving(feel) ? " practice-move" : ""}`}>
        <ExerciseCard
          key={current.id}
          exercise={current}
          feedback={feedback}
          submitted={submitted}
          onSubmit={(s) => void submit(s)}
          onContinue={() => advance(answeredRef.current, skippedRef.current)}
          onSpeak={speak}
          continueLabel={last ? "Finish" : "Continue"}
          onWord={(form, sentence, el) => inspector.open(form, sentence, el)}
          {...(topic ? { topic } : {})}
          onSaidRight={() => void saidRight()}
          sayDutch={feel.sayDutch}
          onTick={() => playSound("tick", feel)}
          onMiss={() => playSound("wrong", feel)}
          onTryAgain={tryAgain}
          onSkipSpeaking={skipSpeaking}
          {...(phoneListens
            ? { listenLive: { start: androidListen, stop: androidStopListening } }
            : {})}
          {...(services.listening
            ? {
                onHear: async (rec: Blob) => services.listening!.hear(await toWav16k(rec)),
              }
            : {})}
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

/**
 * The end of a lesson: a ring fills to the share you got right while the number counts up, a few
 * sparks, and the three-note chime (Settings → Practice; still and silent when those are off).
 */
function DoneRing({ share }: { share: number }) {
  const feel = useFeel();
  const move = moving(feel);
  const [shown, setShown] = useState(move ? 0 : share);
  useEffect(() => {
    playSound("done", feel);
    if (!move) return;
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / 900);
      setShown(Math.round(share * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // Once, when the lesson ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className={`done-ring${move ? " done-ring--sparks" : ""}`} aria-hidden>
      <div className="done-ring-fill" style={{ "--share": `${shown}%` } as React.CSSProperties}>
        <b>{shown}%</b>
      </div>
      {move
        ? Array.from({ length: 12 }, (_, i) => (
            <i
              key={i}
              style={
                {
                  "--dx": `${Math.cos((i / 12) * Math.PI * 2) * 90}px`,
                  "--dy": `${Math.sin((i / 12) * Math.PI * 2) * 90}px`,
                } as React.CSSProperties
              }
            />
          ))
        : null}
    </div>
  );
}

/** Lessons finished today on this device, and the goal (one a day). */
const TODAY_KEY = "vuurtoren.practice.today";
/** Answers after which leaving a lesson halfway still counts it for today. */
const LEAVE_COUNTS = 3;
const DAILY_GOAL = 1;

const today = () => new Date().toDateString();

function readToday(): number {
  const r = readLocalJSON(TODAY_KEY) as { day?: string; n?: number } | null;
  return r?.day === today() && typeof r.n === "number" ? r.n : 0;
}

/** A lesson was finished: count it for today. */
export function countLessonToday(): void {
  writeLocalJSON(TODAY_KEY, { day: today(), n: readToday() + 1 });
}

function TodayCount() {
  const n = readToday();
  const share = Math.min(1, n / DAILY_GOAL);
  return (
    <span className="today-count">
      <span
        className="today-ring"
        style={{ "--share": `${share * 100}%` } as React.CSSProperties}
        aria-hidden
      />
      {n >= DAILY_GOAL
        ? `${plural(n, "lesson")} today`
        : `${n} of ${DAILY_GOAL} ${DAILY_GOAL === 1 ? "lesson" : "lessons"} today`}
    </span>
  );
}

/** One lesson to start from, as on the mock. */
function LessonCard({
  icon,
  title,
  sub,
  main = false,
  label,
  words,
  disabled = false,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  sub: string;
  main?: boolean;
  /** The accessible name, when it should say more than the title. */
  label?: string;
  /** The lesson's words, shown as chips (the main card on a computer). */
  words?: string[];
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`lesson-card${main ? " lesson-card--main" : ""}`}
      onClick={onClick}
      disabled={disabled}
      {...(label ? { "aria-label": label } : {})}
    >
      <span className="lesson-icon">{icon}</span>
      <span className="lesson-text">
        <b>{title}</b>
        <small>{sub}</small>
        {words?.length ? (
          <span className="lesson-chips" lang="nl">
            {words.slice(0, 6).map((k) => (
              <span key={k} className="lesson-chip">
                {k}
              </span>
            ))}
            {words.length > 6 ? <span className="lesson-chip">+{words.length - 6}</span> : null}
          </span>
        ) : null}
      </span>
      <ChevronRight size={18} className="lesson-go" aria-hidden />
    </button>
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
  ms,
}: {
  /** How long the lesson took. */
  ms?: number;
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
        : "Nothing to practise yet. Sync Anki (Your words), or read a text and start learning a few words.");
    return (
      <>
        <PageHeader title={emptyTitle} lede={lede} />
        {actions ?? <Button onClick={onAgain}>Back</Button>}
      </>
    );
  }
  const correct = answered.filter((a) => a.result.correct).length;
  const again = [...new Set(answered.filter((a) => !a.result.correct).map((a) => a.exercise.key))];
  const practised = [...new Set(answered.map((a) => a.exercise.key))];
  const share = answered.length ? Math.round((correct / answered.length) * 100) : 0;
  const minutes = Math.max(1, Math.round((ms ?? 0) / 60_000));
  // Words whose next practice is due by tomorrow evening.
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(23, 59, 59, 999);
  const soon = [
    ...new Set(
      answered.filter((a) => a.result.next.due <= tomorrow.getTime()).map((a) => a.exercise.key),
    ),
  ];
  // A grammar point missed twice or more in this lesson: its page.
  const missedTopics = new Map<string, number>();
  for (const a of answered)
    if (!a.result.correct && a.exercise.topic)
      missedTopics.set(a.exercise.topic, (missedTopics.get(a.exercise.topic) ?? 0) + 1);
  const [weakTopic, weakMisses] = [...missedTopics].sort((x, y) => y[1] - x[1])[0] ?? [];
  const weak = weakTopic && (weakMisses ?? 0) >= 2 ? grammarTopic(weakTopic) : undefined;
  return (
    <>
      <PageHeader
        title="Lesson done"
        lede={
          answered.length === 0
            ? "No exercises were answered."
            : `${correct} of ${answered.length} correct.`
        }
      />
      {answered.length > 0 ? <DoneRing share={share} /> : null}
      <dl className="done-stats">
        <div>
          <dt>Words</dt>
          <dd>{practised.length}</dd>
        </div>
        <div>
          <dt>Right</dt>
          <dd>{share}%</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>{ms === undefined ? "–" : `${minutes} min`}</dd>
        </div>
      </dl>
      {answered.length > 0 ? (
        <p className="k-hint practice-note">
          {soon.length ? (
            <>
              <span lang="nl">{soon.slice(0, 3).join(", ")}</span>
              {soon.length > 3 ? ` and ${soon.length - 3} more` : ""}{" "}
              {soon.length === 1 ? "comes" : "come"} back tomorrow.{" "}
            </>
          ) : null}
          <TodayCount />
        </p>
      ) : null}
      {weak ? (
        <p className="practice-note">
          {weak.title}: {weakMisses} missed.{" "}
          <Link to="/grammar/$topic" params={{ topic: weak.id }}>
            Read about it
          </Link>
        </p>
      ) : null}
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
  const navigate = useNavigate();
  // Enter goes on reading (the text you came from), Esc back to Practice.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (shortcutBlocked(e)) return;
      if (e.target instanceof HTMLElement && e.target.closest("button,a,input")) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onAgain();
      } else if (e.key === "Enter" && next) {
        e.preventDefault();
        void navigate({ to: "/read/$textId", params: { textId: next.text.id } });
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [next, navigate, onAgain]);
  return (
    <nav className="practice-next" aria-label="Next steps">
      <Button variant={next ? "secondary" : "primary"} onClick={onAgain}>
        Practise again{" "}
        <kbd className="ex-key" aria-hidden>
          Esc
        </kbd>
      </Button>
      <Link
        to="/words/all"
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
        <span>Talk about these words</span>
        <ArrowRight size={16} aria-hidden />
      </Link>
      {next ? (
        <Link to="/read/$textId" params={{ textId: next.text.id }} className="practice-next-link">
          <BookOpen size={18} aria-hidden />
          <span>
            {next.started ? "Continue reading" : "Next text"}{" "}
            <kbd className="ex-key" aria-hidden>
              Enter
            </kbd>
            <small>{next.text.title}</small>
          </span>
          <ArrowRight size={16} aria-hidden />
        </Link>
      ) : (
        <Link to="/" className="practice-next-link">
          <BookOpen size={18} aria-hidden />
          <span>
            Next text
            <small>Pick a story or one of your texts</small>
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
