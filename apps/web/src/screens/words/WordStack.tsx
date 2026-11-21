/**
 * Your words as a stack of cards (phones and desktop): one word at a time with its article, its
 * meaning, the sentence it came from and play. Chips on top choose the words (met while
 * reading, learning, new, or a starter level); the search icon opens the list, filtered.
 *
 * Swipe right (or →, or the button) is **I know it**: the word's card gets the same known
 * schedule as the word sheet's I know it (`services.markKnown`, an Anki-compatible mature review
 * state). Swipe left (or ←) is **Keep learning**: a new card goes to the front of the new queue
 * (`services.learnNext`, Study first); a word without a card is added to your words first; a
 * word already being learned just goes by. A tap opens the word sheet with everything else.
 *
 * Each answer waits a few seconds before it is saved, with a small Undo toast; the next
 * answer, leaving the page or hiding the app saves it at once. Nothing new is stored on a
 * card, so .apkg export is unchanged.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, RotateCcw, Search, Undo2 } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { clipId, wordClipText } from "@app/anki";
import { Button, EmptyState, Skeleton, useNativeMode, useToast } from "@app/ui";
import { PlayButton, useSay } from "../../audio/useSay.js";
import { useServices } from "../../services/context.js";
import { errorText } from "../../services/errors.js";
import type { AppServices, InspectorEntry } from "../../services/types.js";
import { useDeckChoice } from "../useDeckChoice.js";
import { type StarterIndex, levelOf } from "./levels.js";
import { ALL_WORDS, loadStarterIndex } from "./WordsRoom.js";
import "./wordStack.css";

/** Which words the stack holds. */
export type StackChoice = "reading" | "learning" | "new" | `level:${number}`;

/** One card of the stack. */
export interface StackCard {
  key: string;
  article?: string | undefined;
  gloss?: string | undefined;
}

export type StackAnswer = "known" | "learn";

/** How long (ms) an answer waits for Undo before it is saved. */
export const UNDO_MS = 5000;
/** A drag this far (px) sideways is an answer; less springs back. */
const DECIDES = 96;
/** Cards loaded per choice. */
const STACK_SIZE = 200;

const LIVE_STATES = new Set(["unknown", "seen", "learning"]);

/** The cards of a choice: words met while reading first, by level in starter order. */
export async function loadStack(
  services: AppServices,
  choice: StackChoice,
  index: StarterIndex | undefined,
): Promise<StackCard[]> {
  const card = (w: { key: string; article?: string | undefined; gloss?: string | undefined }) => ({
    key: w.key,
    article: w.article,
    gloss: w.gloss,
  });
  if (choice === "reading") return (await services.wordsToDecide({ limit: STACK_SIZE })).map(card);
  if (choice === "learning")
    return (await services.words({ state: "learning", limit: STACK_SIZE })).map(card);
  if (choice === "new") {
    const [seen, fresh] = await Promise.all([
      services.words({ state: "seen", limit: STACK_SIZE }),
      services.words({ state: "unknown", limit: STACK_SIZE }),
    ]);
    return [...seen, ...fresh].map(card);
  }
  const level = Number(choice.slice("level:".length));
  if (!index) return [];
  const keys = [...index.rank.keys()].filter((k) => levelOf(index, k) === level);
  const rank = (k: string) => index.rank.get(k) ?? 0;
  return (await services.words({ keys, limit: ALL_WORDS }))
    .filter((w) => LIVE_STATES.has(w.state))
    .sort((a, b) => rank(a.key) - rank(b.key))
    .slice(0, STACK_SIZE)
    .map(card);
}

/**
 * Save one answer with the word sheet's own actions: I know it is `markKnown`; Keep learning is
 * Study first for a new or suspended card, adds a word without a card first, and leaves a word
 * already being learned as it is.
 */
export async function saveAnswer(
  services: AppServices,
  entry: InspectorEntry,
  answer: StackAnswer,
  deck: string | undefined,
): Promise<void> {
  const opts = deck ? { deck } : undefined;
  if (answer === "known") {
    await services.markKnown(entry, opts);
    return;
  }
  const status = entry.anki.status;
  if (status === "absent") {
    await services.addToAnki(entry, opts);
    await services.learnNext(await services.inspectWord(entry.key));
  } else if (status === "new" || status === "suspended") {
    await services.learnNext(entry);
  }
}

/** Cached views that show word states; refreshed after a saved answer. */
const WORD_VIEWS = ["words", "learner", "home", "textWords", "texts", "practice", "review"];

interface Pending {
  key: string;
  answer: StackAnswer;
  timer: ReturnType<typeof setTimeout>;
}

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

export function WordStack({
  levels,
  onOpen,
  onSearch,
}: {
  /** The starter levels to offer as chips. */
  levels: readonly number[];
  /** Show a word's details in the word sheet. */
  onOpen: (key: string) => void;
  /** Open the list to find a word. */
  onSearch: () => void;
}) {
  const services = useServices();
  const native = useNativeMode();
  const qc = useQueryClient();
  const toast = useToast();
  const deckChoice = useDeckChoice("reading");
  const { play, playing } = useSay();
  const [choice, setChoice] = useState<StackChoice>("reading");
  /** Keys answered in this visit (saved or waiting), so they leave the stack at once. */
  const [answered, setAnswered] = useState<readonly string[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const entries = useRef(new Map<string, InspectorEntry>());

  const index = useQuery({
    queryKey: ["starter-index"],
    queryFn: loadStarterIndex,
    staleTime: Infinity,
  });
  const stack = useQuery({
    queryKey: ["words", "stack", choice, index.data ? "index" : "none"],
    queryFn: () => loadStack(services, choice, index.data),
    enabled: !choice.startsWith("level:") || !!index.data,
  });
  const cards = (stack.data ?? []).filter((c) => !answered.includes(c.key));
  const top = cards[0] ?? null;
  const next = cards[1] ?? null;
  const entry = useQuery({
    queryKey: ["inspect-word", top?.key ?? null],
    queryFn: () => services.inspectWord(top!.key),
    enabled: top !== null,
  });
  const loaded = top && entry.data ? entry.data : null;
  useEffect(() => {
    if (top && loaded) entries.current.set(top.key, loaded);
  }, [top, loaded]);
  // The card under the top one is ready before it shows.
  useEffect(() => {
    if (next)
      void qc.prefetchQuery({
        queryKey: ["inspect-word", next.key],
        queryFn: () => services.inspectWord(next.key),
      });
  }, [next, qc, services]);

  const deck = deckChoice.chosen;
  const commit = useCallback(
    (p: Pending) => {
      clearTimeout(p.timer);
      if (pendingRef.current === p) {
        pendingRef.current = null;
        setPending(null);
      }
      void (async () => {
        try {
          const e = entries.current.get(p.key) ?? (await services.inspectWord(p.key));
          await saveAnswer(services, e, p.answer, deck);
          for (const k of WORD_VIEWS) void qc.invalidateQueries({ queryKey: [k] });
          void qc.invalidateQueries({ queryKey: ["inspect-word", p.key] });
        } catch (err) {
          setAnswered((a) => a.filter((k) => k !== p.key));
          toast(
            p.answer === "known"
              ? "Could not mark the word as known"
              : "Could not keep the word for learning",
            errorText(err),
          );
        }
      })();
    },
    [services, deck, qc, toast],
  );

  const answer = useCallback(
    (key: string, a: StackAnswer) => {
      // The answer before this one is saved now.
      if (pendingRef.current) commit(pendingRef.current);
      setAnswered((list) => [...list, key]);
      const p: Pending = { key, answer: a, timer: setTimeout(() => commit(p), UNDO_MS) };
      pendingRef.current = p;
      setPending(p);
    },
    [commit],
  );

  const undo = () => {
    const p = pendingRef.current;
    if (!p) return;
    clearTimeout(p.timer);
    pendingRef.current = null;
    setPending(null);
    setAnswered((list) => list.filter((k) => k !== p.key));
  };

  // Leaving the page or hiding the app saves the waiting answer.
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden" && pendingRef.current) commit(pendingRef.current);
    };
    document.addEventListener("visibilitychange", flush);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      if (pendingRef.current) commit(pendingRef.current);
    };
  }, [commit]);

  // The card follows the finger (with a little rotation) and springs away or back.
  const cardRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; id: number; dx: number; moved: boolean } | null>(
    null,
  );
  const [leaving, setLeaving] = useState<StackAnswer | null>(null);
  const place = (dx: number) => {
    const el = cardRef.current;
    if (!el) return;
    el.style.setProperty("--drag-x", `${dx}px`);
    el.style.setProperty("--drag-r", `${dx / 18}deg`);
    el.dataset["lean"] = dx > 24 ? "known" : dx < -24 ? "learn" : "";
  };
  const fling = (a: StackAnswer) => {
    if (!top) return;
    const key = top.key;
    if (reducedMotion()) {
      place(0);
      answer(key, a);
      return;
    }
    setLeaving(a);
    window.setTimeout(() => {
      setLeaving(null);
      place(0);
      answer(key, a);
    }, 220);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || leaving) return;
    if ((e.target as Element).closest("button")) return;
    drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId, dx: 0, moved: false };
    cardRef.current?.setAttribute("data-dragging", "");
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    d.dx = e.clientX - d.x;
    if (!d.moved && Math.abs(d.dx) > 6 && Math.abs(d.dx) > Math.abs(e.clientY - d.y)) {
      d.moved = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    if (d.moved) place(d.dx);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    cardRef.current?.removeAttribute("data-dragging");
    if (!d.moved) {
      if (top && e.type === "pointerup") onOpen(top.key);
      return;
    }
    if (d.dx >= DECIDES) fling("known");
    else if (d.dx <= -DECIDES) fling("learn");
    else place(0);
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (!top || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      fling("known");
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      fling("learn");
    } else if (e.key === "Enter" && e.target === e.currentTarget) {
      e.preventDefault();
      onOpen(top.key);
    }
  };

  const chips: { id: StackChoice; label: string }[] = [
    { id: "reading", label: "Met while reading" },
    { id: "learning", label: "Learning" },
    { id: "new", label: "New" },
    ...levels.map((l) => ({ id: `level:${l}` as StackChoice, label: `Level ${l}` })),
  ];
  const e = loaded;
  const [from, to] = e?.sentenceHighlight ?? [0, 0];
  const lemma = e?.lemma ?? top?.key ?? "";
  const article = e?.article ?? top?.article;
  const meaning = e?.glosses[0] ?? e?.sentenceGloss ?? top?.gloss;
  const hasCard = e ? e.anki.status !== "absent" : false;

  return (
    <section className="word-stack" aria-label="Your words, one at a time">
      <div className="word-stack-top">
        <div className="word-stack-chips" role="radiogroup" aria-label="Which words">
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={choice === c.id}
              className="word-stack-chip"
              onClick={() => setChoice(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" icon aria-label="Find a word" onClick={onSearch}>
          <Search size={18} aria-hidden />
        </Button>
      </div>

      {stack.isPending ? (
        <Skeleton className="word-stack-skeleton" />
      ) : stack.isError ? (
        <p role="alert" className="error-text">
          The words could not be loaded. {errorText(stack.error)}
        </p>
      ) : !top ? (
        <EmptyState
          title="No words here"
          description={
            choice === "reading"
              ? "New words from your reading wait here. Read a text, or choose another set above."
              : "Choose another set above, or find a word in the list."
          }
        />
      ) : (
        <>
          <div className="word-stack-deck">
            {next ? <div className="word-stack-card word-stack-card--under" aria-hidden /> : null}
            <div
              key={top.key}
              ref={cardRef}
              className="word-stack-card"
              data-leaving={leaving ?? undefined}
              role="group"
              aria-roledescription="word card"
              aria-label={`${article ? `${article} ` : ""}${lemma}. Swipe right or press the right arrow for I know it, left for Keep learning, Enter for details.`}
              tabIndex={0}
              onKeyDown={onKeyDown}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <span className="word-stack-stamp word-stack-stamp--known" aria-hidden>
                I know it
              </span>
              <span className="word-stack-stamp word-stack-stamp--learn" aria-hidden>
                Keep learning
              </span>
              <div className="word-stack-head">
                <h2 className="word-stack-word" lang="nl">
                  {article ? <span className="word-stack-article">{article} </span> : null}
                  {lemma}
                </h2>
                <PlayButton
                  label={`Play “${lemma}”`}
                  playing={playing === `stack:${top.key}`}
                  onPlay={() =>
                    void (async () =>
                      play(`stack:${top.key}`, {
                        clip: await clipId("word", wordClipText(lemma, article ?? undefined)),
                        text: lemma,
                      }))()
                  }
                />
              </div>
              <p className="word-stack-meaning">{meaning ?? (e ? "No meaning yet" : "")}</p>
              {e?.sentence ? (
                <p className="word-stack-sentence" lang="nl">
                  {e.sentence.slice(0, from)}
                  <mark>{e.sentence.slice(from, to)}</mark>
                  {e.sentence.slice(to)}
                </p>
              ) : null}
              <p className="word-stack-hint">
                {hasCard
                  ? "Tap for details"
                  : `Not in ${native ? "your words" : "Anki"} yet · tap for details`}
              </p>
            </div>
          </div>
          <div className="word-stack-actions">
            <Button onClick={() => fling("learn")} disabled={!!leaving}>
              <RotateCcw size={16} aria-hidden /> Keep learning
            </Button>
            <Button variant="primary" onClick={() => fling("known")} disabled={!!leaving}>
              <Check size={16} aria-hidden /> I know it
            </Button>
          </div>
          <p className="word-stack-count" aria-live="polite">
            {cards.length === 1 ? "The last word here" : `${cards.length} words to go`}
          </p>
        </>
      )}

      {pending ? (
        <div className="word-stack-undo" role="status">
          <span>
            {pending.answer === "known" ? "Marked as known" : "Kept for learning"}:{" "}
            <span lang="nl">{pending.key}</span>
          </span>
          <Button variant="ghost" size="sm" onClick={undo}>
            <Undo2 size={14} aria-hidden /> Undo
          </Button>
        </div>
      ) : null}
    </section>
  );
}
