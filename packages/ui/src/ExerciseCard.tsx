/**
 * One practice exercise, rendered by its interaction type (choice, gender, scramble, typed,
 * dictation) with keyboard shortcuts. Pure UI: the caller grades the answer and passes the
 * result back as `feedback`.
 *
 * Keys: 1-9 pick a choice (1 = de, 2 = het for gender) or place a tile, Enter submits /
 * continues, Backspace takes the last tile back, ? reveals a letter or places the next tile.
 * Holding a tile (or right-clicking it) shows what the word means; that counts as help.
 */
import { Check, Mic, Snail, Square, Volume2, X } from "lucide-react";
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
  /** Speak a text (dictation); `rate` below 1 is slower. */
  onSpeak?: (text: string, rate?: number) => void;
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
  /** "I can't talk now": skip speaking for the rest of the lesson. */
  onSkipSpeaking?: () => void;
  /** "Say this sentence" was misheard: count it as right. */
  onSaidRight?: () => void;
  /** "Say this sentence" missed: the mic again, for the same sentence. */
  onTryAgain?: () => void;
  /** Say Dutch by itself: the word when it appears, the right answer after answering. */
  sayDutch?: boolean;
  /** A small sound: a tile placed, a pair matched. */
  onTick?: () => void;
  /** The not-quite sound, for a pair that doesn't match. */
  onMiss?: () => void;
  /** "Say this sentence" with the device's own recogniser (Android): it listens itself. */
  listenLive?: { start: () => Promise<string>; stop: () => void };
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

type Mode = "choice" | "gender" | "scramble" | "typed" | "dictation" | "say" | "meet" | "pairs";

/** Which interaction an exercise needs (derived from its data, so new kinds degrade sensibly). */
function exerciseMode(e: Exercise): Mode {
  if (e.kind === "gender") return "gender";
  if (e.kind === "dictation") return "dictation";
  if (e.kind === "say") return "say";
  if (e.kind === "meet") return "meet";
  if (e.kind === "pairs") return "pairs";
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
  listenLive,
  onSaidRight,
  onSkipSpeaking,
  onTryAgain,
  sayDutch = false,
  onTick,
  onMiss,
}: ExerciseCardProps) {
  const mode = exerciseMode(e);
  const answered = feedback !== null;
  const [text, setText] = useState("");
  const [hints, setHints] = useState(0);
  const [picked, setPicked] = useState<number[]>([]);
  /** A tile just taken back (and a count, so it flies down again each time). */
  const [back, setBack] = useState<{ i: number; n: number } | null>(null);
  const takeBack = (at: number | "last") =>
    setPicked((cur) => {
      const n = at === "last" ? cur.length - 1 : at;
      const i = cur[n];
      if (i !== undefined) setBack((b) => ({ i, n: (b?.n ?? 0) + 1 }));
      return cur.filter((_, m) => m !== n);
    });
  /** The speaker pulses while the card says something. */
  const [saying, setSaying] = useState(false);
  const sayTimer = useRef<number | undefined>(undefined);
  const say = (text: string, rate?: number) => {
    if (!onSpeak) return;
    onSpeak(text, rate);
    setSaying(true);
    window.clearTimeout(sayTimer.current);
    sayTimer.current = window.setTimeout(() => setSaying(false), 1200);
  };
  useEffect(() => () => window.clearTimeout(sayTimer.current), []);
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
    const right = e.answer.split(/\s+/).map(fold).filter(Boolean);
    const placed = picked.map((i) => fold(pieces[i]!));
    // Undo a wrong start first, so the hint always builds on a right one.
    if (placed.some((w, n) => w !== right[n])) {
      setPicked([]);
      setHints((h) => h + 1);
      return;
    }
    const want = right[placed.length];
    const at = pieces.findIndex((p, i) => !picked.includes(i) && fold(p) === want);
    if (at >= 0) {
      setPicked((cur) => [...cur, at]);
      setHints((h) => h + 1);
    }
  };
  const holdTimer = useRef<number | null>(null);
  const touch = useRef(false);
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

  // Speak a dictation or a sentence to build once when it appears (the browser may block it;
  // the button always works).
  useEffect(() => {
    if (mode === "dictation" || e.kind === "listen-build") say(e.prompt.speak ?? e.answer);
    // A Dutch word on its own is said as it appears (Settings → Practice).
    else if (
      sayDutch &&
      (e.kind === "meaning-choice" || e.kind === "gender" || e.kind === "meet" || e.kind === "say")
    )
      say(e.prompt.text);
  }, [e.id]);

  useEffect(() => {
    if (!answered && (mode === "typed" || mode === "dictation")) inputRef.current?.focus();
  }, [e.id, answered, mode]);

  // Keyboard: window-level so it works without focusing a control first.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.repeat) return;
      if (shortcutBlocked(ev, cardRef.current)) return;
      if (mode === "meet") {
        if (ev.key === "Enter" && !(ev.target instanceof HTMLButtonElement)) {
          ev.preventDefault();
          onContinue();
        }
        return;
      }
      if (mode === "pairs") return;
      const typingNow = ev.target instanceof HTMLInputElement;
      // Space hears the Dutch again: the sentence after answering, the word or sentence before.
      // (A focused button keeps Space as its click.)
      if (ev.key === " " && !typingNow && onSpeak && !(ev.target instanceof HTMLButtonElement)) {
        const before =
          e.kind === "meaning-choice" || e.kind === "gender" || e.kind === "say"
            ? e.prompt.text
            : e.kind === "listen-build" || e.kind === "dictation"
              ? (e.prompt.speak ?? e.answer)
              : null;
        const text = answered ? resultDutch : before;
        if (text) {
          ev.preventDefault();
          onSpeak(text);
          return;
        }
      }
      if (mode === "say" && !answered && /^s$/i.test(ev.key) && onSkipSpeaking) {
        ev.preventDefault();
        onSkipSpeaking();
        return;
      }
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
          takeBack("last");
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
    e.kind === "scramble" || e.kind === "dictation" || e.kind === "listen-build"
      ? e.answer
      : e.kind === "meaning-choice"
        ? e.prompt.text
        : (e.prompt.sentence ?? e.answer);
  // After answering, the right Dutch is said (Settings → Practice).
  useEffect(() => {
    if (feedback && sayDutch && resultDutch && e.kind !== "pairs") say(resultDutch);
  }, [feedback !== null]);

  const englishLine =
    !dutchPrompt || !e.prompt.translation || e.kind === "scramble" || e.kind === "listen-build"
      ? null
      : e.prompt.translation;

  if (mode === "meet")
    return (
      <section
        className={cn("ex-card", saying && "ex-card--saying")}
        aria-label="Exercise"
        ref={cardRef}
      >
        <h2 className="ex-ask ex-tag">{e.instruction}</h2>
        <div className="ex-meet">
          <p className="ex-prompt-row">
            {onSpeak ? (
              <SpeakButton onClick={() => onSpeak(e.prompt.text)} label="Play the word" />
            ) : null}
            <span className="ex-meet-word ex-dutch" lang="nl">
              {e.prompt.text}
            </span>
          </p>
          {e.prompt.hint ? <p className="ex-meet-meaning">{e.prompt.hint}</p> : null}
          {e.prompt.sentence ? (
            <p className="ex-dutch ex-meet-sentence" lang="nl">
              {e.prompt.sentence}
            </p>
          ) : null}
          {e.prompt.translation ? <p className="ex-en">{e.prompt.translation}</p> : null}
        </div>
        <div className="ex-foot">
          <Button variant="primary" className="ex-check" onClick={onContinue}>
            Got it <kbd className="ex-key">Enter</kbd>
          </Button>
        </div>
      </section>
    );
  if (mode === "pairs")
    return (
      <section
        className={cn("ex-card", saying && "ex-card--saying")}
        aria-label="Exercise"
        ref={cardRef}
      >
        <h2 className="ex-ask">{e.instruction}</h2>
        <Pairs
          pairs={e.pairs ?? []}
          onDone={onContinue}
          onSay={sayDutch ? onSpeak : undefined}
          onTick={onTick}
          onMiss={onMiss}
        />
      </section>
    );

  return (
    <section
      className={cn("ex-card", saying && "ex-card--saying")}
      aria-label="Exercise"
      ref={cardRef}
    >
      <h2 className="ex-ask">{e.instruction}</h2>
      {e.kind === "listen-build" ? (
        <div className="ex-hear">
          <button
            type="button"
            className="ex-say ex-say--big"
            onClick={() => say(e.prompt.speak ?? e.answer)}
            aria-label="Play the sentence"
          >
            <Volume2 size={24} aria-hidden />
          </button>
          <button
            type="button"
            className="ex-say ex-say--slow"
            onClick={() => say(e.prompt.speak ?? e.answer, 0.6)}
            aria-label="Play it slowly"
            title="Slowly"
          >
            <Snail size={18} aria-hidden />
          </button>
        </div>
      ) : mode !== "dictation" ? (
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
            onClick={() => say(e.prompt.speak ?? e.answer)}
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
                className="ex-piece ex-piece--placed ex-piece--fly"
                disabled={answered}
                onClick={() => takeBack(n)}
              >
                {pieces[i]}
              </button>
            ))}
          </div>
          <div className="ex-pieces ex-dutch" lang="nl" role="group" aria-label="Words">
            {pieces.map((p, i) => (
              <button
                key={back?.i === i ? `${i}-${back.n}` : i}
                type="button"
                className={cn(
                  "ex-piece",
                  picked.includes(i) && "ex-piece--gone",
                  back?.i === i && !picked.includes(i) && "ex-piece--back",
                )}
                disabled={answered || picked.includes(i)}
                onClick={() => {
                  if (holdTimer.current === -1) {
                    holdTimer.current = null;
                    return; // the press was a hold: it showed the meaning
                  }
                  setPicked((cur) => [...cur, i]);
                  onTick?.();
                  say(p);
                }}
                onContextMenu={(ev) => {
                  ev.preventDefault();
                  // A long press already showed it (phones fire this too).
                  if (holdTimer.current === -1) return;
                  if (holdTimer.current) window.clearTimeout(holdTimer.current);
                  // On a touch screen the release still clicks: swallow that click.
                  holdTimer.current = touch.current ? -1 : null;
                  peek(p, ev.currentTarget);
                }}
                onPointerDown={(ev) => {
                  touch.current = ev.pointerType === "touch";
                  if (ev.button !== 0) return;
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
                {i < 9 ? (
                  <sup className="ex-tile-n" aria-hidden>
                    {i + 1}
                  </sup>
                ) : null}
                {p}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {mode === "say" && !answered ? (
        <>
          <SayIt onHear={onHear} live={listenLive} onHeard={(heard) => submit(heard)} />
          {onSkipSpeaking ? (
            <div className="ex-foot">
              <Button variant="ghost" onClick={onSkipSpeaking}>
                I can&rsquo;t talk now <kbd className="ex-key">S</kbd>
              </Button>
            </div>
          ) : null}
        </>
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
              {!feedback.correct &&
              submitted &&
              (mode === "scramble" || mode === "dictation" || mode === "say") ? (
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
          {e.kind === "say" && !feedback.correct && (onTryAgain || onSaidRight) ? (
            <div className="ex-actions">
              {onTryAgain ? (
                <Button variant="secondary" onClick={onTryAgain}>
                  Try again
                </Button>
              ) : null}
              {onSaidRight ? (
                <Button variant="ghost" onClick={onSaidRight}>
                  I said it right
                </Button>
              ) : null}
            </div>
          ) : null}
          <Button variant="primary" className="ex-continue" onClick={onContinue}>
            {continueLabel} <kbd className="ex-key">Enter</kbd>
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/** Match pairs: tap a Dutch word, then its meaning. A warm-up, so misses only flash. */
function Pairs({
  pairs,
  onDone,
  onSay,
  onTick,
  onMiss,
}: {
  pairs: readonly { nl: string; en: string }[];
  onDone: () => void;
  /** Say a Dutch word when it's tapped. */
  onSay?: ((text: string) => void) | undefined;
  /** A small sound on a match. */
  onTick?: (() => void) | undefined;
  /** The not-quite sound on a pair that doesn't match. */
  onMiss?: (() => void) | undefined;
}) {
  // The meanings in a fixed shuffled order (by length, then text), so they don't line up.
  const [meanings] = useState(() =>
    [...pairs].sort((a, b) => a.en.length - b.en.length || a.en.localeCompare(b.en)),
  );
  const [picked, setPicked] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [miss, setMiss] = useState<string | null>(null);
  const [missNl, setMissNl] = useState<string | null>(null);
  const all = done.size === pairs.length;
  const tryMeaning = (en: string) => {
    if (!picked) return;
    const right = pairs.find((p) => p.nl === picked)?.en === en;
    if (right) {
      setDone((d) => new Set(d).add(picked));
      setPicked(null);
      onTick?.();
    } else {
      setMiss(en);
      setMissNl(picked);
      onMiss?.();
      window.setTimeout(() => {
        setMiss(null);
        setMissNl(null);
      }, 500);
    }
  };
  return (
    <>
      <div className="ex-pairs">
        <div role="group" aria-label="Dutch">
          {pairs.map((p) => (
            <button
              key={p.nl}
              type="button"
              lang="nl"
              className={cn(
                "ex-pair ex-dutch",
                picked === p.nl && "ex-pair--on",
                done.has(p.nl) && "ex-pair--done",
                missNl === p.nl && "ex-pair--miss",
              )}
              disabled={done.has(p.nl)}
              aria-pressed={picked === p.nl}
              onClick={() => {
                setPicked(p.nl);
                onSay?.(p.nl);
              }}
            >
              {p.nl}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Meanings">
          {meanings.map((p) => (
            <button
              key={p.en}
              type="button"
              className={cn(
                "ex-pair",
                done.has(p.nl) && "ex-pair--done",
                miss === p.en && "ex-pair--miss",
              )}
              disabled={done.has(p.nl) || !picked}
              onClick={() => tryMeaning(p.en)}
            >
              {p.en}
            </button>
          ))}
        </div>
      </div>
      <div className="ex-foot">
        <Button variant="primary" className="ex-check" disabled={!all} onClick={onDone}>
          Continue
        </Button>
      </div>
    </>
  );
}

/** The mic for "Say this sentence": tap to talk, tap to stop; then what was heard is sent. */
function SayIt({
  onHear,
  live,
  onHeard,
}: {
  onHear: ((recording: Blob) => Promise<string>) | undefined;
  live: { start: () => Promise<string>; stop: () => void } | undefined;
  onHeard: (heard: string) => void;
}) {
  const [state, setState] = useState<"idle" | "on" | "listening">("idle");
  const [why, setWhy] = useState<string | null>(null);
  const rec = useRef<{ stop: () => Promise<Blob>; cancel: () => void } | null>(null);
  const alive = useRef(true);
  // Only on leaving: a new `live` object on a re-render must not stop the listening.
  const liveRef = useRef(live);
  liveRef.current = live;
  const listeningLive = useRef(false);
  useEffect(
    () => () => {
      alive.current = false;
      rec.current?.cancel();
      if (listeningLive.current) liveRef.current?.stop();
    },
    [],
  );
  // M starts and stops the mic, like a tap.
  const toggle = useRef<() => void>(() => undefined);
  useEffect(() => {
    const key = (ev: KeyboardEvent) => {
      if (!/^m$/i.test(ev.key) || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      // Not while typing, or while a dialog (the word card) owns the keys.
      if (shortcutBlocked(ev)) return;
      ev.preventDefault();
      toggle.current();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  if (!onHear && !live) return <p className="ex-hint">Speaking needs the language server.</p>;
  /** The phone listens itself and stops after a pause, or on the second tap. */
  const startLive = async (l: NonNullable<typeof live>) => {
    setState("on");
    listeningLive.current = true;
    try {
      const heard = await l.start().finally(() => (listeningLive.current = false));
      if (!alive.current) return;
      if (heard.trim()) onHeard(heard);
      else {
        setWhy("Nothing heard. Try again.");
        setState("idle");
      }
    } catch (err) {
      if (!alive.current) return;
      setWhy(err instanceof Error ? err.message : "Speech recognition didn't work. Try again.");
      setState("idle");
    }
  };
  const start = async () => {
    setWhy(null);
    if (live) return startLive(live);
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const parts: Blob[] = [];
      mr.ondataavailable = (ev) => parts.push(ev.data);
      mr.start();
      const open = stream;
      const done = () => open.getTracks().forEach((t) => t.stop());
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
      // The mic opened but recording didn't start: close it again.
      stream?.getTracks().forEach((t) => t.stop());
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
    if (live) {
      setState("listening");
      live.stop();
      return;
    }
    const r = rec.current;
    rec.current = null;
    if (!r) return;
    setState("listening");
    try {
      const heard = await onHear!(await r.stop());
      // Gone meanwhile (the lesson ended): the answer belongs to no exercise now.
      if (alive.current) onHeard(heard);
    } catch {
      if (!alive.current) return;
      setWhy("Couldn't hear that. Try again.");
      setState("idle");
    }
  };
  toggle.current = () => {
    if (state === "listening") return;
    void (state === "on" ? stop() : start());
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
