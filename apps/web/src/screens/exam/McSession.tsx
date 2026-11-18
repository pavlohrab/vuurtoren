/**
 * A multiple-choice session (Lezen, Luisteren, KNM). Exam mode: timed, free navigation, no
 * feedback until you hand in. Practice mode: instant feedback with an explanation.
 */
import { ArrowLeft, ArrowRight, Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type ExamPart,
  type ListeningFragment,
  type McGroup,
  type McQuestion,
  groupQuestions,
  missedVocab,
  optionOrder,
  scoreMc,
} from "@app/content";
import { normalizeKey } from "@app/core";
import { Button, Chip } from "@app/ui";
import { useExamClock } from "../../exam/timer.js";
import { RATES, speakLines } from "../../exam/tts.js";
import { dutchVoiceAvailable } from "../../practice/speech.js";
import { ExamClock, ScoreCard, WordsToLearn, useRecordAttempt } from "./shared.js";

/** Plays allowed per fragment in exam mode (practice: unlimited). */
export const EXAM_PLAYS = 2;

interface Screen {
  key: string;
  group: McGroup;
  questions: McQuestion[];
}

/** One screen per text or fragment; KNM shows one question per screen. */
export function screensOf(groups: readonly McGroup[]): Screen[] {
  return groups.flatMap((group): Screen[] =>
    group.kind === "knm"
      ? group.questions.map((q) => ({ key: q.id, group, questions: [q] }))
      : [{ key: group.item.id, group, questions: group.item.questions }],
  );
}

export interface McSessionProps {
  part: Extract<ExamPart, "lezen" | "luisteren" | "knm">;
  mode: "exam" | "practice";
  groups: McGroup[];
  setId: string;
  title: string;
  /** Exam mode time limit. */
  limitMs: number;
  onExit: () => void;
  /** Practice mode: do not record (e.g. a single generated item is still recorded). */
  record?: boolean;
}

export function McSession({
  part,
  mode,
  groups,
  setId,
  title,
  limitMs,
  onExit,
  record = true,
}: McSessionProps) {
  const screens = useMemo(() => screensOf(groups), [groups]);
  const questions = useMemo(() => groupQuestions(groups), [groups]);
  const [seed, setSeed] = useState(() => String(Date.now()));
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [finished, setFinished] = useState(false);
  const recordAttempt = useRecordAttempt();
  const clock = useExamClock(mode === "exam" ? limitMs : null, !finished, () => finish());
  const top = useRef<HTMLDivElement>(null);

  function finish() {
    if (finished) return;
    setFinished(true);
    const s = scoreMc(part, questions, answers);
    const words = missedVocab(groups, s.wrong).map((w) => normalizeKey(w.lemma));
    if (record) {
      recordAttempt.mutate({
        part,
        mode,
        setId,
        correct: s.correct,
        total: s.total,
        passMark: s.passMark,
        durationMs: clock.elapsed,
        missed: s.wrong,
        words,
      });
    }
  }

  function restart() {
    setSeed(String(Date.now()));
    setAnswers({});
    setIndex(0);
    setFinished(false);
  }

  useEffect(() => {
    top.current?.scrollIntoView?.({ block: "start" });
  }, [index, finished]);

  const screen = screens[index];
  const answered = Object.keys(answers).length;

  if (finished) {
    return (
      <div className="exam-session" ref={top}>
        <McResults
          part={part}
          mode={mode}
          groups={groups}
          answers={answers}
          seed={seed}
          title={title}
          onRestart={restart}
          onExit={onExit}
        />
      </div>
    );
  }
  if (!screen) return null;
  const screenDone = screen.questions.every((q) => answers[q.id] !== undefined);
  const last = index === screens.length - 1;

  return (
    <div className="exam-session" ref={top} data-mode={mode}>
      <div className="exam-bar" role="region" aria-label="Session">
        <span className="exam-bar-title">{title}</span>
        <span className="exam-bar-progress">
          {part === "knm" ? "Question" : part === "lezen" ? "Text" : "Fragment"} {index + 1} of{" "}
          {screens.length}
        </span>
        <ExamClock remaining={clock.remaining} elapsed={clock.elapsed} />
        <Button size="sm" variant={mode === "exam" ? "primary" : "secondary"} onClick={finish}>
          {mode === "exam" ? `Hand in (${answered}/${questions.length})` : "Finish"}
        </Button>
      </div>

      <div className="exam-screen">
        {screen.group.kind === "text" ? (
          <article className="exam-paper" aria-label={screen.group.item.title} lang="nl">
            <h2 className="exam-paper-title">{screen.group.item.title}</h2>
            <div className="exam-paper-body">{screen.group.item.text}</div>
          </article>
        ) : screen.group.kind === "fragment" ? (
          <ListeningPlayer
            key={screen.key}
            fragment={screen.group.item}
            limit={mode === "exam" ? EXAM_PLAYS : null}
            showTranscript={mode === "practice" && screenDone}
          />
        ) : (
          <p className="exam-theme">
            <Chip>{screen.group.theme.title}</Chip>
          </p>
        )}

        <div className="exam-questions">
          {screen.questions.map((q, i) => (
            <QuestionBlock
              key={q.id}
              n={part === "knm" ? index + 1 : i + 1}
              question={q}
              order={optionOrder(q, seed)}
              chosen={answers[q.id]}
              reveal={mode === "practice" && answers[q.id] !== undefined}
              onChoose={(opt) => {
                if (mode === "practice" && answers[q.id] !== undefined) return;
                setAnswers((a) => ({ ...a, [q.id]: opt }));
              }}
            />
          ))}
        </div>
      </div>

      <div className="exam-nav">
        <Button variant="ghost" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>
          <ArrowLeft size={16} aria-hidden /> Previous
        </Button>
        {last ? (
          <Button variant="primary" onClick={finish}>
            {mode === "exam" ? "Hand in" : "See results"}
          </Button>
        ) : (
          <Button
            variant={mode === "practice" && screenDone ? "primary" : "secondary"}
            onClick={() => setIndex((i) => i + 1)}
          >
            Next <ArrowRight size={16} aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}

function QuestionBlock({
  n,
  question,
  order,
  chosen,
  reveal,
  onChoose,
}: {
  n: number;
  question: McQuestion;
  order: number[];
  chosen: number | undefined;
  reveal: boolean;
  onChoose: (option: number) => void;
}) {
  const name = `q-${question.id}`;
  return (
    <fieldset className="exam-q">
      <legend className="exam-q-text" lang="nl">
        <span className="exam-q-n">{n}.</span> {question.q}
      </legend>
      <div className="exam-options" role="radiogroup" aria-label={question.q}>
        {order.map((opt, k) => {
          const state = !reveal
            ? undefined
            : opt === question.answer
              ? "right"
              : opt === chosen
                ? "wrong"
                : undefined;
          return (
            <label
              key={opt}
              className="exam-option"
              data-state={state}
              data-chosen={chosen === opt || undefined}
            >
              <input
                type="radio"
                name={name}
                checked={chosen === opt}
                onChange={() => onChoose(opt)}
                disabled={reveal}
              />
              <span className="exam-option-letter" aria-hidden>
                {"ABCD"[k]}
              </span>
              <span lang="nl">{question.options[opt]}</span>
            </label>
          );
        })}
      </div>
      {reveal ? (
        <p className="exam-explain" role="status">
          <strong>{chosen === question.answer ? "Right." : "Not quite."}</strong> {question.explain}
        </p>
      ) : null}
    </fieldset>
  );
}

/** Plays a fragment with the Dutch voice; exam mode allows `limit` plays. */
export function ListeningPlayer({
  fragment,
  limit,
  showTranscript,
}: {
  fragment: ListeningFragment;
  limit: number | null;
  showTranscript: boolean;
}) {
  const [plays, setPlays] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [line, setLine] = useState(-1);
  const [rate, setRate] = useState<number>(0.9);
  const [voice, setVoice] = useState<boolean | null>(null);
  const cancel = useRef<(() => void) | null>(null);

  useEffect(() => {
    let live = true;
    void dutchVoiceAvailable(1500).then((ok) => live && setVoice(ok));
    return () => {
      live = false;
      cancel.current?.();
    };
  }, []);

  const left = limit === null ? null : limit - plays;
  const play = () => {
    if (playing) {
      cancel.current?.();
      return;
    }
    if (left !== null && left <= 0) return;
    setPlays((p) => p + 1);
    setPlaying(true);
    const run = speakLines(fragment.lines, { rate, onLine: setLine });
    cancel.current = run.cancel;
    void run.done
      .catch(() => setVoice(false))
      .finally(() => {
        setPlaying(false);
        setLine(-1);
      });
  };

  return (
    <section className="exam-listen" aria-label="Listening fragment">
      <p className="exam-listen-context" lang="nl">
        {fragment.context}
      </p>
      {voice === false ? (
        <p className="exam-muted" role="status">
          This browser has no Dutch voice, so the fragment is shown as text.
        </p>
      ) : (
        <div className="exam-listen-controls">
          <Button
            variant="primary"
            onClick={play}
            disabled={voice === null || (!playing && left !== null && left <= 0)}
            aria-label={playing ? "Stop" : plays ? "Play again" : "Play"}
          >
            {playing ? (
              <Pause size={16} aria-hidden />
            ) : plays ? (
              <RotateCcw size={16} aria-hidden />
            ) : (
              <Play size={16} aria-hidden />
            )}
            {playing ? "Stop" : plays ? "Play again" : "Play"}
          </Button>
          <div className="exam-rates" role="group" aria-label="Speed">
            {RATES.map((r) => (
              <button
                key={r}
                type="button"
                className="exam-rate"
                aria-pressed={rate === r}
                onClick={() => setRate(r)}
                disabled={playing}
              >
                {r === 1 ? "1×" : `${r}×`}
              </button>
            ))}
          </div>
          <span className="exam-muted">
            {left === null ? `Played ${plays}×` : `${left} of ${limit} plays left`}
            {playing && line >= 0 ? ` · ${fragment.lines[line]?.who ?? ""}` : ""}
          </span>
        </div>
      )}
      {showTranscript || voice === false ? <Transcript fragment={fragment} /> : null}
    </section>
  );
}

export function Transcript({ fragment }: { fragment: ListeningFragment }) {
  return (
    <dl className="exam-transcript" lang="nl" aria-label="Transcript">
      {fragment.lines.map((l, i) => (
        <div key={i} className="exam-transcript-line">
          <dt>{l.who}</dt>
          <dd>{l.text}</dd>
        </div>
      ))}
    </dl>
  );
}

function McResults({
  part,
  mode,
  groups,
  answers,
  seed,
  title,
  onRestart,
  onExit,
}: {
  part: McSessionProps["part"];
  mode: "exam" | "practice";
  groups: McGroup[];
  answers: Record<string, number>;
  seed: string;
  title: string;
  onRestart: () => void;
  onExit: () => void;
}) {
  const questions = groupQuestions(groups);
  const score = scoreMc(part, questions, answers);
  const wrong = new Set(score.wrong);
  const words = missedVocab(groups, score.wrong);
  const themes =
    part === "knm"
      ? groups.flatMap((g) =>
          g.kind === "knm"
            ? [
                {
                  id: g.theme.id,
                  title: g.theme.title,
                  total: g.questions.length,
                  right: g.questions.filter((q) => !wrong.has(q.id)).length,
                },
              ]
            : [],
        )
      : [];
  return (
    <div className="exam-results">
      <header className="exam-results-head">
        <p className="exam-eyebrow">
          {mode === "exam" ? "Mock exam" : "Practice"} · {title}
        </p>
        <h2>Your result</h2>
      </header>
      <ScoreCard part={part} score={score} mode={mode} unit="questions" />

      {themes.length > 1 ? (
        <section aria-labelledby="exam-themes-h">
          <h2 id="exam-themes-h">By theme</h2>
          <ul className="exam-theme-list">
            {themes.map((t) => (
              <li key={t.id} data-weak={t.right / t.total < 0.6 || undefined}>
                <span>{t.title}</span>
                <span className="exam-muted">
                  {t.right} / {t.total}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <WordsToLearn words={words} />

      <section aria-labelledby="exam-review-h">
        <h2 id="exam-review-h">Review</h2>
        <ol className="exam-review">
          {groups.map((g) => {
            const qs = g.kind === "knm" ? g.questions : g.item.questions;
            return (
              <li key={g.kind === "knm" ? g.theme.id : g.item.id} className="exam-review-group">
                <details open={qs.some((q) => wrong.has(q.id))}>
                  <summary>
                    {g.kind === "knm"
                      ? g.theme.title
                      : g.kind === "text"
                        ? g.item.title
                        : g.item.context}{" "}
                    <span className="exam-muted">
                      {qs.filter((q) => !wrong.has(q.id)).length} / {qs.length}
                    </span>
                  </summary>
                  {g.kind === "fragment" ? <Transcript fragment={g.item} /> : null}
                  {g.kind === "text" ? (
                    <div className="exam-paper-body exam-review-text" lang="nl">
                      {g.item.text}
                    </div>
                  ) : null}
                  <ul className="exam-review-qs">
                    {qs.map((q) => (
                      <li key={q.id} data-wrong={wrong.has(q.id) || undefined}>
                        <p lang="nl">{q.q}</p>
                        <p>
                          <span className="exam-muted">Your answer: </span>
                          <span lang="nl">
                            {answers[q.id] === undefined ? "—" : q.options[answers[q.id]!]}
                          </span>
                        </p>
                        {wrong.has(q.id) ? (
                          <p>
                            <span className="exam-muted">Right answer: </span>
                            <span lang="nl">{q.options[q.answer]}</span>
                          </p>
                        ) : null}
                        <p className="exam-muted">{q.explain}</p>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            );
          })}
        </ol>
      </section>

      <div className="exam-nav">
        <Button variant="ghost" onClick={onExit}>
          <ArrowLeft size={16} aria-hidden /> Back
        </Button>
        <Button variant="primary" onClick={onRestart} data-seed={seed}>
          <RotateCcw size={16} aria-hidden /> Try again
        </Button>
      </div>
    </div>
  );
}
