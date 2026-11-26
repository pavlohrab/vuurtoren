/**
 * One practice exercise, rendered by its interaction type (choice, gender, scramble, typed,
 * dictation) with keyboard shortcuts. Pure UI: the caller grades the answer and passes the
 * result back as `feedback`.
 *
 * Keys: 1-9 pick a choice (1 = de, 2 = het for gender) or place a tile, Enter submits /
 * continues, Backspace takes the last tile back, ? reveals a letter or places the next tile.
 * Holding a tile (or right-clicking it) shows what the word means; that counts as help.
 */
import { Check, Mic, Square, Volume2, X } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import type { Exercise } from "@app/core";
import { Button } from "./Button.js";
import { WordText } from "./WordText.js";
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
  /**
   * After answering, the Dutch answer and sentence open the word inspector: a word as written
   * and the sentence it stands in.
   */
  onWord?: (form: string, sentence: string | undefined, el: HTMLElement) => void;
  /** The grammar page behind this exercise, linked after a miss. */
  topic?: { title: string; onOpen: () => void };
  /** "Say this sentence": what the language server heard in a recording. */
  onHear?: (recording: Blob) => Promise<string>;
}

/** Elements that mean another layer (dialog, command palette) owns the keyboard. */
const OVERLAY = '[role="dialog"],[role="alertdialog"],[cmdk-root],[data-shortcuts-blocked]';

/**
 * True when a window-level shortcut must not fire for `ev`: it was already handled, it comes
 * from an editable element outside `scope` (e.g. the command palette's search box), or a dialog
 * or palette is open. Register shortcut listeners in the capture phase so a dialog that closes
 * on this very key press is still seen as open.
 */
export function shortcutBlocked(ev: KeyboardEvent, scope?: Element | null): boolean {
  if (ev.defaultPrevented) return true;
  const t = ev.target instanceof Element ? ev.target : null;
  if (t?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) {
    if (!scope || !scope.contains(t)) return true;
  }
  return document.querySelector(OVERLAY) !== null;
}

/** Kinds whose prompt text is English (the rest show Dutch in the reading face). */
const ENGLISH_PROMPT = new Set(["word-choice", "scramble"]);

type Mode = "choice" | "gender" | "scramble" | "typed" | "dictation" | "say";

/** Which interaction an exercise needs (derived from its data, so new kinds degrade sensibly). */
function exerciseMode(e: Exercise): Mode {
  if (e.kind === "gender") return "gender";
  if (e.kind === "dictation") return "dictation";
  if (e.kind === "say") return "say";
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
  onWord,
  topic,
  onHear,
}: ExerciseCardProps) {
  const mode = exerciseMode(e);
  const answered = feedback !== null;
  const [text, setText] = useState("");
  const [hints, setHints] = useState(0);
  const [picked, setPicked] = useState<number[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLElement>(null);

  const choices = mode === "gender" ? (e.choices ?? ["de", "het"]) : (e.choices ?? []);
  const pieces = e.pieces ?? [];

  const submit = (answer: string) => {
    if (answered) return;
    onSubmit({ answer, hintsUsed: hints });
  };
  const scrambleAnswer = () => picked.map((i) => pieces[i]).join(" ");
  /** Hint while building: place the next tile of the right sentence (counts as help). */
  const nextTile = () => {
    if (answered) return;
    const want = e.answer
      .split(/\s+/)
      .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").toLowerCase())
      .filter(Boolean)[picked.length];
    // Undo a wrong tile first, so the hint always builds on a right start.
    const rightSoFar = e.answer
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s'-]/gu, "")
      .startsWith(picked.map((i) => pieces[i]!.toLowerCase()).join(" "));
    if (!rightSoFar) {
      setPicked([]);
      setHints((h) => h + 1);
      return;
    }
    const at = pieces.findIndex(
      (p, i) => !picked.includes(i) && p.replace(/[^\p{L}\p{N}'-]/gu, "").toLowerCase() === want,
    );
    if (at >= 0) {
      setPicked((cur) => [...cur, at]);
      setHints((h) => h + 1);
    }
  };
  const holdTimer = useRef<number | null>(null);
  const peek = (piece: string, el: HTMLElement) => {
    if (!onWord) return;
    setHints((h) => h + 1);
    onWord(piece, undefined, el);
  };
  // Letters can be revealed up to one short of the whole word; the last step gives up
  // (submitted empty, so it counts as not recalled and the answer is shown).
  const maxHints = Math.max(0, e.answer.length - 1);
  const lastStep = hints >= maxHints;
  const revealHint = () => {
    if (answered) return;
    if (lastStep) onSubmit({ answer: "", hintsUsed: hints });
    else setHints((h) => h + 1);
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
      if (shortcutBlocked(ev, cardRef.current)) return;
      if (answered) {
        // A focused button or word handles Enter itself (its click would otherwise fire a
        // second time, or a word would open and the card move on at once).
        const own =
          ev.target instanceof HTMLButtonElement ||
          (ev.target instanceof HTMLElement && ev.target.closest("[data-word]") !== null);
        if (ev.key === "Enter" && !own) {
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
        if (/^[1-9]$/.test(ev.key)) {
          const i = Number(ev.key) - 1;
          if (i < pieces.length && !picked.includes(i)) {
            ev.preventDefault();
            setPicked((p) => [...p, i]);
          }
        } else if (ev.key === "?") {
          ev.preventDefault();
          nextTile();
        } else if (ev.key === "Backspace") {
          ev.preventDefault();
          setPicked((p) => p.slice(0, -1));
        } else if (ev.key === "Enter" && picked.length > 0) {
          ev.preventDefault();
          submit(scrambleAnswer());
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const onTypedSubmit = (ev: FormEvent) => {
    ev.preventDefault();
    if (text.trim()) submit(text.trim());
  };

  const dutchPrompt = !ENGLISH_PROMPT.has(e.kind);
  const hintText =
    hints > 0 ? `${e.answer.slice(0, hints)}${hints < e.answer.length ? "…" : ""}` : "";
  const hintLabel = lastStep ? "Show answer" : "Hint";
  // A Dutch word on its own can be heard before answering; a sentence only after (it would
  // give the answer away).
  const sayFirst =
    (e.kind === "meaning-choice" || e.kind === "gender" || e.kind === "say") && onSpeak;
  // The Dutch that is shown after answering: the whole sentence when there is one.
  const resultDutch =
    e.kind === "scramble" || e.kind === "dictation"
      ? e.answer
      : e.kind === "meaning-choice"
        ? e.prompt.text
        : (e.prompt.sentence ?? e.answer);
  const englishLine =
    !dutchPrompt || !e.prompt.translation || e.kind === "scramble" ? null : e.prompt.translation;

  return (
    <section className="ex-card" aria-label="Exercise" ref={cardRef}>
      <h2 className="ex-ask">{e.instruction}</h2>
      {mode !== "dictation" ? (
        <div className="ex-prompt-row">
          {sayFirst ? (
            <SpeakButton onClick={() => onSpeak(e.prompt.text)} label="Play the word" />
          ) : null}
          <PromptText text={e.prompt.text} dutch={dutchPrompt} />
        </div>
      ) : null}
      {englishLine ? <p className="ex-en">{englishLine}</p> : null}
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
                className={cn("ex-piece", picked.includes(i) && "ex-piece--gone")}
                disabled={answered || picked.includes(i)}
                onClick={() => {
                  if (holdTimer.current === -1) {
                    holdTimer.current = null;
                    return; // the press was a hold: it showed the meaning
                  }
                  setPicked((cur) => [...cur, i]);
                  onSpeak?.(p);
                }}
                onContextMenu={(ev) => {
                  ev.preventDefault();
                  peek(p, ev.currentTarget);
                }}
                onPointerDown={(ev) => {
                  const el = ev.currentTarget;
                  holdTimer.current = window.setTimeout(() => {
                    holdTimer.current = -1;
                    peek(p, el);
                  }, 500);
                }}
                onPointerUp={() => {
                  if (holdTimer.current && holdTimer.current > 0) {
                    window.clearTimeout(holdTimer.current);
                    holdTimer.current = null;
                  }
                }}
                onPointerLeave={() => {
                  if (holdTimer.current && holdTimer.current > 0) {
                    window.clearTimeout(holdTimer.current);
                    holdTimer.current = null;
                  }
                }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {mode === "say" && !answered ? (
        <SayIt onHear={onHear} onHeard={(heard) => submit(heard)} />
      ) : null}

      {mode === "typed" || mode === "dictation" ? (
        <form className="ex-typed" id={`ex-form-${e.id}`} onSubmit={onTypedSubmit}>
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
              } else if (ev.key === "Enter" && !ev.nativeEvent.isComposing && !answered) {
                // Submit explicitly rather than relying on implicit form submission.
                ev.preventDefault();
                ev.currentTarget.form?.requestSubmit();
              }
            }}
          />
        </form>
      ) : null}

      {!answered && (mode === "scramble" || mode === "typed" || mode === "dictation") ? (
        <div className="ex-foot">
          {mode === "scramble" ? (
            <Button variant="ghost" onClick={nextTile} aria-label="Place the next word">
              Hint <kbd className="ex-key">?</kbd>
            </Button>
          ) : (
            <Button
              variant="ghost"
              onClick={revealHint}
              aria-label={lastStep ? "Show the answer" : "Reveal a letter"}
            >
              {hintLabel} <kbd className="ex-key">?</kbd>
            </Button>
          )}
          {mode === "scramble" ? (
            <Button
              variant="primary"
              className="ex-check"
              disabled={picked.length === 0}
              onClick={() => submit(scrambleAnswer())}
            >
              Check
            </Button>
          ) : (
            <Button
              variant="primary"
              className="ex-check"
              type="submit"
              form={`ex-form-${e.id}`}
              disabled={!text.trim()}
            >
              Check
            </Button>
          )}
        </div>
      ) : null}

      {feedback ? (
        <div
          className={cn("ex-strip", feedback.correct ? "ex-strip--right" : "ex-strip--wrong")}
          role="status"
        >
          <p className="ex-verdict">
            {feedback.correct ? <Check size={18} aria-hidden /> : <X size={18} aria-hidden />}
            {feedback.correct ? "Right" : "Not quite"}
          </p>
          <p className="ex-strip-dutch ex-dutch" lang="nl">
            {onSpeak ? (
              <SpeakButton onClick={() => onSpeak(resultDutch)} label="Play the sentence" />
            ) : null}
            <span>
              {!feedback.correct && submitted && (mode === "scramble" || mode === "dictation" || mode === "say") ? (
                <MarkedSentence answer={resultDutch} given={submitted} />
              ) : onWord ? (
                <WordText
                  text={resultDutch}
                  onWord={(form, el) => onWord(form, e.prompt.sentence ?? e.answer, el)}
                />
              ) : (
                resultDutch
              )}
            </span>
          </p>
          {resultDutch !== e.answer && !feedback.correct ? (
            <p>
              Answer:{" "}
              <strong className="ex-dutch" lang="nl">
                {e.answer}
              </strong>
            </p>
          ) : null}
          {e.prompt.translation ? <p className="ex-translation">{e.prompt.translation}</p> : null}
          {feedback.note ? <p>{feedback.note}</p> : null}
          {e.explanation ? (
            <p className="ex-explanation">
              {e.explanation}
              {topic && !feedback.correct ? (
                <>
                  {" "}
                  <button type="button" className="ex-topic" onClick={topic.onOpen}>
                    More about {topic.title}
                  </button>
                </>
              ) : null}
            </p>
          ) : null}
          {e.metIn ? (
            <p className="ex-metin">
              Where you met it:{" "}
              <span className="ex-dutch" lang="nl">
                {e.metIn.text}
              </span>
            </p>
          ) : null}
          <Button variant="primary" className="ex-continue" onClick={onContinue}>
            {continueLabel} <kbd className="ex-key">Enter</kbd>
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/** The mic for "Say this sentence": tap to talk, tap to stop; then what was heard is sent. */
function SayIt({
  onHear,
  onHeard,
}: {
  onHear: ((recording: Blob) => Promise<string>) | undefined;
  onHeard: (heard: string) => void;
}) {
  const [state, setState] = useState<"idle" | "on" | "listening">("idle");
  const [why, setWhy] = useState<string | null>(null);
  const rec = useRef<{ stop: () => Promise<Blob>; cancel: () => void } | null>(null);
  useEffect(() => () => rec.current?.cancel(), []);
  if (!onHear) return <p className="ex-hint">Speaking needs the language server.</p>;
  const start = async () => {
    setWhy(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const parts: Blob[] = [];
      mr.ondataavailable = (ev) => parts.push(ev.data);
      mr.start();
      const done = () => stream.getTracks().forEach((t) => t.stop());
      rec.current = {
        stop: () =>
          new Promise<Blob>((ok) => {
            mr.onstop = () => {
              done();
              ok(new Blob(parts, { type: mr.mimeType }));
            };
            mr.stop();
          }),
        cancel: () => {
          if (mr.state !== "inactive") mr.stop();
          done();
        },
      };
      setState("on");
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      setWhy(
        name === "NotAllowedError"
          ? "The microphone isn't allowed."
          : name === "NotFoundError"
            ? "No microphone found."
            : "The microphone didn't start.",
      );
    }
  };
  const stop = async () => {
    const r = rec.current;
    rec.current = null;
    if (!r) return;
    setState("listening");
    try {
      onHeard(await onHear(await r.stop()));
    } catch {
      setWhy("Couldn't hear that. Try again.");
      setState("idle");
    }
  };
  return (
    <div className="ex-say-it">
      <button
        type="button"
        className={cn("ex-mic", state === "on" && "on")}
        disabled={state === "listening"}
        onClick={() => void (state === "on" ? stop() : start())}
        aria-label={state === "on" ? "Stop and check" : "Start talking"}
      >
        {state === "on" ? <Square size={22} aria-hidden /> : <Mic size={26} aria-hidden />}
      </button>
      <span className="ex-hint" role="status">
        {why ??
          (state === "on"
            ? "Talking… tap to stop."
            : state === "listening"
              ? "Listening…"
              : "Tap and say it.")}
      </span>
    </div>
  );
}

/** Fold a word for comparing: lower case, no punctuation at the edges. */
const fold = (w: string) => w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

/** The right sentence with the words that differ from the learner's underlined, place by place. */
function MarkedSentence({ answer, given }: { answer: string; given: string }) {
  const theirs = given.split(/\s+/).filter(Boolean).map(fold);
  const words = answer.split(/(\s+)/);
  let n = -1;
  return (
    <>
      {words.map((w, i) => {
        if (/^\s+$/.test(w) || !w) return w;
        n++;
        return fold(w) === theirs[n] ? (
          <span key={i}>{w}</span>
        ) : (
          <u key={i} className="ex-diff">
            {w}
          </u>
        );
      })}
    </>
  );
}

/** The round speaker button next to Dutch text. */
function SpeakButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" className="ex-say" onClick={onClick} aria-label={label}>
      <Volume2 size={15} aria-hidden />
    </button>
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
