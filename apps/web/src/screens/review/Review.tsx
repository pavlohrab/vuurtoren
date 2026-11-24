/**
 * The review session (native mode), in focus mode: no menus, the card alone. Front, then a tap,
 * Space or "Show answer" for the back, then Again / Hard / Good / Easy with the next interval on
 * each button (keys 1–4; Space is Good) or a swipe: left Again, right Good, up Easy.
 * Today's cards are the queue (due first, then new words within the daily limit). When they are
 * done, the session can go on with more new words or learning words ahead of time (`?more=`).
 * Answers can be taken back one by one (Undo or Z), also after a reload or on another day.
 * Vocabulary cards say their word (R replays it) and sentence: the audio pack's clip, else the
 * system voice; the word plays as the front shows, the sentence on reveal (Settings).
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import { Undo2, Volume2, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, Skeleton } from "@app/ui";
import { plural } from "../../format.js";
import { useServices } from "../../services/context.js";
import { errorText } from "../../services/errors.js";
import type { CardRating, ReviewCard } from "../../services/nativeTypes.js";
import { usePageHeader } from "../../shell/ShellContext.js";
import { sanitizeCardHtml } from "./sanitize.js";
import { useMediaUrls } from "./useMedia.js";
import { ErrorNotice } from "../../shell/ErrorNotice.js";
import { PlayButton, useSay } from "../../audio/useSay.js";
import type { Saying } from "../../audio/play.js";
import { useSwipe } from "./useSwipe.js";
import "./review.css";

const RATINGS: { rating: CardRating; label: string }[] = [
  { rating: 1, label: "Again" },
  { rating: 2, label: "Hard" },
  { rating: 3, label: "Good" },
  { rating: 4, label: "Easy" },
];

/** Answers that can be taken back (newest last). */
interface Answered {
  cardId: number;
  reviewId: string;
}

/** The pause between a card's word and its sentence. */
const SENTENCE_PAUSE_MS = 600;

/** How many extra cards one "Continue" asks for. */
const MORE = { new: 10, learning: 20 } as const;

export function Review() {
  usePageHeader("Review");
  const services = useServices();
  const qc = useQueryClient();
  const { more: moreParam }: { more?: string } = useSearch({ from: "/review" });
  const more: "new" | "learning" | null =
    moreParam === "new" || moreParam === "learning" ? moreParam : null;
  // Extra cards still to give in this session (each answer uses one up).
  const [extraLeft, setExtraLeft] = useState<number>(more ? MORE[more] : 0);
  const [extraFor, setExtraFor] = useState(more);
  if (extraFor !== more) {
    setExtraFor(more);
    setExtraLeft(more ? MORE[more] : 0);
  }
  const extra = more && extraLeft > 0 ? { kind: more, count: extraLeft } : undefined;
  useFocusMode();
  const queue = useQuery({
    queryKey: ["review", "queue", more, extraLeft],
    queryFn: () => services.reviewQueue(extra),
    staleTime: Infinity,
    gcTime: 0,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(0);
  const [undo, setUndo] = useState<Answered[]>([]);
  /** After an undo, this card comes first. */
  const [first, setFirst] = useState<number | null>(null);
  const shownAt = useRef(0);

  const cards = useMemo(() => {
    const list = queue.data?.cards ?? [];
    if (first === null) return list;
    const i = list.findIndex((c) => c.cardId === first);
    return i > 0 ? [list[i]!, ...list.slice(0, i), ...list.slice(i + 1)] : list;
  }, [queue.data, first]);
  const card = cards[0];

  // The answer is shown for one card at a time: a new card (or the same one again, after an
  // answer or an undo) starts hidden. Every answer and undo is a new turn.
  const [turn, setTurn] = useState(0);
  const cardKey = card ? `${card.cardId}:${turn}` : "";
  const [shownKey, setShownKey] = useState<string | null>(null);
  const shown = shownKey === cardKey;
  const setShown = useCallback((on: boolean) => setShownKey(on ? cardKey : null), [cardKey]);
  useEffect(() => {
    shownAt.current = Date.now();
  }, [cardKey]);

  // Sound: the word as the front shows, the sentence as the answer shows (each a setting).
  const speech = useSay();
  const { play } = speech;
  const audio = speech.settings;
  const wordSaying = useMemo<Saying | null>(
    () => (card?.spoken ? { clip: card.wordAudio, text: card.spoken } : null),
    [card],
  );
  const sentenceSaying = useMemo<Saying | null>(
    () => (card?.sentence ? { clip: card.sentenceAudio, text: card.sentence } : null),
    [card],
  );
  const autoWord = audio?.autoplayWord ?? false;
  const autoSentence = audio?.autoplaySentence ?? false;
  // A vocabulary card shows the word on its front, so the word plays as it shows; a card of an
  // imported deck may ask for the word (English on the front), so its word plays with the answer.
  const wordFirst = card?.layout === "vocab";
  // A vocabulary card says its word as it shows, then (a short pause) its sentence.
  useEffect(() => {
    if (!cardKey || !wordFirst) return;
    let stopped = false;
    void (async () => {
      if (autoWord && wordSaying) await play("word", wordSaying);
      if (stopped || !autoSentence || !sentenceSaying) return;
      await new Promise((r) => setTimeout(r, SENTENCE_PAUSE_MS));
      if (!stopped) await play("sentence", sentenceSaying);
    })();
    return () => {
      stopped = true;
    };
  }, [cardKey, autoWord, autoSentence, wordSaying, sentenceSaying, wordFirst, play]);
  useEffect(() => {
    if (shown && autoWord && wordSaying && !wordFirst) void play("word", wordSaying);
  }, [shown, autoWord, wordSaying, wordFirst, play]);

  const refresh = useCallback(async () => {
    await queue.refetch();
    void qc.invalidateQueries({ queryKey: ["review", "overview"] });
  }, [queue, qc]);

  // The queue comes again when its next card becomes due (a learning step while the screen is
  // open) and when the app comes back to the foreground. The card on screen stays first.
  const latest = useRef({ refresh, card });
  useEffect(() => {
    latest.current = { refresh, card };
  });
  const refreshKeeping = useCallback(() => {
    const { refresh: again, card: current } = latest.current;
    if (current) setFirst(current.cardId);
    void again();
  }, []);
  const nextDue = queue.data?.nextDue ?? null;
  useEffect(() => {
    if (nextDue === null) return;
    const wait = Math.max(0, nextDue - Date.now()) + 1000;
    // Beyond what a timer can hold (about 24 days): coming back to the app refreshes instead.
    if (wait > 2_000_000_000) return;
    const t = window.setTimeout(refreshKeeping, wait);
    return () => window.clearTimeout(t);
  }, [nextDue, refreshKeeping]);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshKeeping();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refreshKeeping]);

  /** A swiped card is flying off: keys wait, so the next card is not answered by mistake. */
  const leavingRef = useRef(false);
  const answer = useCallback(
    async (rating: CardRating) => {
      if (!card || busy) return;
      setBusy(true);
      setError(null);
      try {
        const { reviewId } = await services.answerReview(
          card.cardId,
          rating,
          Date.now() - shownAt.current,
        );
        setUndo((u) => [...u.slice(-19), { cardId: card.cardId, reviewId }]);
        setFirst(null);
        setDone((d) => d + 1);
        if (more && (more === "learning" || card.isNew)) setExtraLeft((n) => Math.max(0, n - 1));
        setTurn((t) => t + 1);
        await refresh();
      } catch (e) {
        setError(errorText(e, "The answer could not be saved."));
      } finally {
        setBusy(false);
      }
    },
    [card, busy, services, refresh, more],
  );

  // Beyond this session (after a reload, on another day): the latest answer stored.
  const stored = useQuery({
    queryKey: ["review", "last"],
    queryFn: () => services.lastReview(),
    enabled: undo.length === 0,
  });
  const canUndo = undo.length > 0 || !!stored.data;

  const takeBack = useCallback(async () => {
    if (busy) return;
    const own = undo.at(-1);
    setBusy(true);
    setError(null);
    try {
      const last = own ?? (await services.lastReview());
      if (!last) return;
      await services.undoReview(last.cardId, last.reviewId);
      if (own) {
        setUndo((u) => u.slice(0, -1));
        setDone((d) => Math.max(0, d - 1));
      }
      setFirst(last.cardId);
      setTurn((t) => t + 1);
      await refresh();
      await stored.refetch();
    } catch (e) {
      setError(errorText(e, "The answer could not be taken back."));
    } finally {
      setBusy(false);
    }
  }, [undo, busy, services, refresh, stored]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === "z" || e.key === "Z") {
        e.preventDefault();
        void takeBack();
        return;
      }
      if (!card || leavingRef.current) return;
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        if (wordSaying) void play("word", wordSaying);
        return;
      }
      if (!shown) {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          setShown(true);
        }
        return;
      }
      const n = Number(e.key);
      if (n >= 1 && n <= 4) {
        e.preventDefault();
        void answer(n as CardRating);
      } else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        void answer(3);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, shown, setShown, answer, takeBack, wordSaying, play]);

  const left = queue.data ? queue.data.cards.length : 0;
  // A swipe answers on the front too: no need to show the answer first.
  const swipe = useSwipe({
    enabled: !!card && !busy,
    onLeft: () => void answer(1),
    onRight: () => void answer(3),
    onUp: () => void answer(4),
  });
  useLayoutEffect(() => {
    leavingRef.current = swipe.leaving;
  });

  return (
    <div
      className="page page--list review"
      data-answering={card && shown ? "" : undefined}
      {...swipe.handlers}
    >
      <div className="review-top">
        <Link to="/words" className="review-close" aria-label="Close the review">
          <X size={22} aria-hidden />
        </Link>
        <span className="review-progress" role="status">
          {card ? `${done} done · ${plural(left, "card")} to go` : done ? `${done} done` : ""}
        </span>
        {canUndo ? (
          <Button variant="ghost" size="sm" onClick={() => void takeBack()} disabled={busy}>
            <Undo2 size={14} aria-hidden /> Undo <kbd className="ex-key">Z</kbd>
          </Button>
        ) : (
          <span className="review-top-spacer" />
        )}
      </div>
      {queue.isPending ? (
        <Skeleton style={{ height: 280, width: "100%" }} />
      ) : queue.isError ? (
        <ErrorNotice
          title="The cards could not be loaded."
          error={queue.error}
          onRetry={() => void queue.refetch()}
        />
      ) : card ? (
        <>
          <CardView
            key={cardKey}
            card={card}
            shown={shown}
            swipe={swipe}
            onReveal={() => setShown(true)}
            playing={speech.playing}
            onPlay={(which) => {
              const what = which === "word" ? wordSaying : sentenceSaying;
              if (what) void play(which, what);
            }}
          />
          <div className="review-actions">
            {shown ? (
              <div className="review-ratings" role="group" aria-label="How well did you know it?">
                <p className="review-swipe-hint">Swipe: ←&nbsp;Again · Good&nbsp;→ · ↑&nbsp;Easy</p>
                {RATINGS.map(({ rating, label }) => (
                  <button
                    key={rating}
                    type="button"
                    className="review-rating"
                    data-rating={rating}
                    disabled={busy}
                    onClick={() => void answer(rating)}
                  >
                    <span className="review-rating-label">{label}</span>
                    <span className="review-rating-ivl">{card.intervals[rating]}</span>
                    <kbd className="ex-key" aria-hidden>
                      {rating}
                    </kbd>
                  </button>
                ))}
              </div>
            ) : (
              <>
                <p className="review-swipe-hint">
                  Sure already? Swipe: ←&nbsp;Again · Good&nbsp;→ · ↑&nbsp;Easy
                </p>
                <Button variant="primary" onClick={() => setShown(true)}>
                  Show answer <kbd className="ex-key">Space</kbd>
                </Button>
              </>
            )}
          </div>
          {error ? (
            <p className="error-text" role="alert">
              {error}
            </p>
          ) : null}
        </>
      ) : (
        <section className="review-end" aria-labelledby="review-end-title">
          <h1 id="review-end-title" className="review-end-title">
            {done ? "Done for today" : "Nothing due"}
          </h1>
          <p className="review-end-lede">
            {done
              ? `You reviewed ${plural(done, "card")}. They come back when they are due.`
              : "Cards come back when they are due. You can go on with more."}
          </p>
          <div className="review-end-actions">
            <Link
              to="/review"
              search={{ more: "new" }}
              className="k-btn k-btn--primary"
              onClick={() => setExtraLeft(MORE.new)}
            >
              Continue with new words
            </Link>
            <Link
              to="/review"
              search={{ more: "learning" }}
              className="k-btn k-btn--secondary"
              onClick={() => setExtraLeft(MORE.learning)}
            >
              Continue with learning words
            </Link>
            <Link to="/words" className="k-btn k-btn--ghost">
              Back to Words
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}

/** While mounted, the app shows the page alone (no sidebar, tab bar or top bar). */
function useFocusMode() {
  useEffect(() => {
    document.documentElement.dataset["focus"] = "";
    return () => {
      delete document.documentElement.dataset["focus"];
    };
  }, []);
}

function CardView({
  card,
  shown,
  swipe,
  onReveal,
  playing,
  onPlay,
}: {
  card: ReviewCard;
  shown: boolean;
  swipe: ReturnType<typeof useSwipe>;
  onReveal: () => void;
  playing: string | null;
  onPlay: (which: "word" | "sentence") => void;
}) {
  const urls = useMediaUrls(card.media);
  const front = useMemo(() => sanitizeCardHtml(card.front, urls), [card.front, urls]);
  const back = useMemo(() => sanitizeCardHtml(card.back, urls), [card.back, urls]);
  const audio = shown ? [...new Set([...card.audioFront, ...card.audioBack])] : card.audioFront;
  // The screen takes every drag as a swipe; a card too long for the screen scrolls up and down
  // inside itself instead, and still swipes left and right.
  const ref = useRef<HTMLElement>(null);
  const [long, setLong] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const check = () => setLong(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [shown, front, back]);
  return (
    <article
      ref={ref}
      className="review-card"
      data-long={long ? "" : undefined}
      aria-live="polite"
      data-layout={card.layout}
      data-swipe={swipe.direction ?? undefined}
      style={swipe.style}
      onClick={(e) => {
        // A tap on the front shows the answer; buttons inside keep their own action.
        if (!shown && !(e.target as HTMLElement).closest("button")) onReveal();
      }}
    >
      <div className="review-meta k-overline">
        {card.isNew ? "New · " : ""}
        {card.deck}
      </div>
      {card.layout === "vocab" ? (
        <>
          <div className="review-said">
            <p className="review-word" lang="nl">
              {card.article ? <span className="review-article">{card.article} </span> : null}
              {card.word}
            </p>
            {card.spoken ? (
              <PlayButton
                label="Play the word (R)"
                playing={playing === "word"}
                check={{
                  key: `word:${card.wordAudio ?? ""}:${card.spoken}`,
                  what: () => ({ clip: card.wordAudio, text: card.spoken }),
                }}
                onPlay={() => onPlay("word")}
              />
            ) : null}
          </div>
          {card.sentence ? (
            <div className="review-said">
              <p className="review-sentence" lang="nl">
                {card.sentence}
              </p>
              <PlayButton
                label="Play the sentence"
                playing={playing === "sentence"}
                check={{
                  key: `sentence:${card.sentenceAudio ?? ""}:${card.sentence}`,
                  what: () => ({ clip: card.sentenceAudio, text: card.sentence }),
                }}
                onPlay={() => onPlay("sentence")}
              />
            </div>
          ) : null}
          {shown ? (
            <div className="review-back">
              <p className="review-gloss">{card.gloss ?? "No meaning on this card."}</p>
              {card.sentenceTranslation ? (
                <p className="review-translation">{card.sentenceTranslation}</p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div
            className="review-html"
            lang="nl"
            // Sanitised above: formatting tags only, no scripts or event handlers.
            dangerouslySetInnerHTML={{ __html: shown ? back : front }}
          />
          {shown && card.spoken ? (
            <div className="review-said">
              <span className="review-spoken" lang="nl">
                {card.spoken}
              </span>
              <PlayButton
                label="Play the word (R)"
                playing={playing === "word"}
                check={{
                  key: `word:${card.wordAudio ?? ""}:${card.spoken}`,
                  what: () => ({ clip: card.wordAudio, text: card.spoken }),
                }}
                onPlay={() => onPlay("word")}
              />
            </div>
          ) : null}
        </>
      )}
      {audio.length ? (
        <div className="row review-audio">
          {audio.map((name) =>
            urls[name] ? (
              <Button
                key={name}
                size="sm"
                variant="ghost"
                onClick={() => void new Audio(urls[name]).play().catch(() => undefined)}
              >
                <Volume2 size={14} aria-hidden /> Play sound
              </Button>
            ) : null,
          )}
        </div>
      ) : null}
      {shown && card.ownSentence ? (
        <figure className="review-own">
          <figcaption className="k-overline">From your texts · {card.ownSentence.title}</figcaption>
          <blockquote lang="nl">
            {card.ownSentence.text.slice(0, card.ownSentence.highlight[0])}
            <mark>{card.ownSentence.text.slice(...card.ownSentence.highlight)}</mark>
            {card.ownSentence.text.slice(card.ownSentence.highlight[1])}
          </blockquote>
        </figure>
      ) : null}
    </article>
  );
}
