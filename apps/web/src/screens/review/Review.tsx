/**
 * The review screen (native mode): front, then Space or "Show answer" for the back, then
 * Again / Hard / Good / Easy with the next interval on each button (keys 1–4; Space is Good).
 * Answers can be taken back one by one (Undo or Z), also after a reload or on another day.
 * Vocabulary cards say their word (R replays it) and sentence: the audio pack's clip, else the
 * system voice; the word plays as the front shows, the sentence on reveal (Settings).
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Undo2, Volume2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Skeleton } from "@app/ui";
import { plural } from "../../format.js";
import { useServices } from "../../services/context.js";
import { errorText } from "../../services/errors.js";
import type { CardRating, ReviewCard } from "../../services/nativeTypes.js";
import { PageHeader } from "../../shell/PageHeader.js";
import { usePageHeader } from "../../shell/ShellContext.js";
import { sanitizeCardHtml } from "./sanitize.js";
import { useMediaUrls } from "./useMedia.js";
import { ErrorNotice } from "../../shell/ErrorNotice.js";
import { PlayButton, useSay } from "../../audio/useSay.js";
import type { Saying } from "../../audio/play.js";
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

export function Review() {
  usePageHeader("Review");
  const services = useServices();
  const qc = useQueryClient();
  const queue = useQuery({
    queryKey: ["review", "queue"],
    queryFn: () => services.reviewQueue(),
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
  useEffect(() => {
    if (cardKey && autoWord && wordSaying) void play("word", wordSaying);
  }, [cardKey, autoWord, wordSaying, play]);
  useEffect(() => {
    if (shown && autoSentence && sentenceSaying) void play("sentence", sentenceSaying);
  }, [shown, autoSentence, sentenceSaying, play]);

  const refresh = useCallback(async () => {
    await queue.refetch();
    void qc.invalidateQueries({ queryKey: ["review", "overview"] });
  }, [queue, qc]);

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
        setTurn((t) => t + 1);
        await refresh();
      } catch (e) {
        setError(errorText(e, "The answer could not be saved."));
      } finally {
        setBusy(false);
      }
    },
    [card, busy, services, refresh],
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
      if (!card) return;
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

  const counts = queue.data
    ? `${plural(queue.data.due, "card")} due · ${queue.data.fresh} new`
    : null;

  return (
    <div className="page page--list review">
      <div className="review-top">
        <span className="k-hint" role="status">
          {counts}
          {done ? ` · ${done} done` : ""}
        </span>
        {canUndo ? (
          <Button variant="ghost" size="sm" onClick={() => void takeBack()} disabled={busy}>
            <Undo2 size={14} aria-hidden /> Undo <kbd className="ex-key">Z</kbd>
          </Button>
        ) : null}
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
            playing={speech.playing}
            onPlay={(which) => {
              const what = which === "word" ? wordSaying : sentenceSaying;
              if (what) void play(which, what);
            }}
          />
          <div className="review-actions">
            {shown ? (
              <div className="review-ratings" role="group" aria-label="How well did you know it?">
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
              <Button variant="primary" onClick={() => setShown(true)}>
                Show answer <kbd className="ex-key">Space</kbd>
              </Button>
            )}
          </div>
          {error ? (
            <p className="error-text" role="alert">
              {error}
            </p>
          ) : null}
        </>
      ) : (
        <>
          <PageHeader
            title={done ? "Done for now" : "Nothing to review"}
            lede={
              done
                ? `You reviewed ${plural(done, "card")}. Cards come back when they are due.`
                : "No cards are due. Add words while you read, or import a deck in Settings."
            }
          />
          <div className="row">
            <Link to="/library" className="k-btn k-btn--primary">
              Read something
            </Link>
            <Link to="/settings" search={{ section: "language" }} className="k-btn k-btn--ghost">
              Decks and import
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

function CardView({
  card,
  shown,
  playing,
  onPlay,
}: {
  card: ReviewCard;
  shown: boolean;
  playing: string | null;
  onPlay: (which: "word" | "sentence") => void;
}) {
  const urls = useMediaUrls(card.media);
  const front = useMemo(() => sanitizeCardHtml(card.front, urls), [card.front, urls]);
  const back = useMemo(() => sanitizeCardHtml(card.back, urls), [card.back, urls]);
  const audio = shown ? [...new Set([...card.audioFront, ...card.audioBack])] : card.audioFront;
  return (
    <article className="review-card" aria-live="polite" data-layout={card.layout}>
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
        <div
          className="review-html"
          lang="nl"
          // Sanitised above: formatting tags only, no scripts or event handlers.
          dangerouslySetInnerHTML={{ __html: shown ? back : front }}
        />
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
