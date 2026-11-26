import { type KeyboardEvent, type ReactNode, type TouchEvent, useRef, useState } from "react";
import { AddToAnki, type DeckOption, deckName } from "./AddToAnki.js";
import { Button } from "./Button.js";
import { Chip } from "./Chip.js";
import type { InspectorAnki, InspectorEntry } from "@app/core";
import { WordStateChip } from "./WordState.js";

export interface WordInspectorProps {
  entry: InspectorEntry | null;
  onAddToAnki?: (() => void) | undefined;
  /** Move the word's new card to the front of its deck (unsuspends it if needed). */
  onLearnNext?: (() => void) | undefined;
  /** Mark the word known in Anki. */
  onMarkKnown?: (() => void) | undefined;
  /** Drop a manual state so Anki's applies again. */
  onReset?: (() => void) | undefined;
  /**
   * The word was just added to my words: "✓ Added · Undo" in place of the main button for a few
   * seconds; Undo takes it out again.
   */
  onUndo?: (() => void) | undefined;
  /** What was just done, shown before Undo: "✓ Added" (default) or "✓ Known". */
  undoLabel?: string | undefined;
  /** Disables the action buttons while a request is in flight. */
  busy?: boolean | undefined;
  /** The entry is being fetched (e.g. a different word was just selected). */
  loading?: boolean;
  /** Message to show when the entry could not be loaded. */
  error?: string | null;
  onRetry?: () => void;
  /**
   * The deck a new word goes to and the picker's choices. When given, Add to Anki names the
   * deck and lets the learner choose another one (AddToAnki).
   */
  addDeck?: AddDeckChoice | undefined;
  /** What to say when no word is selected. */
  emptyText?: string;
  /** Shown beside the headword (a play button). */
  headerAction?: ReactNode;
  /**
   * The card shows a word opened from another word's card (its base verb, a family word): "←
   * opendoen" above the head goes back one word (notes/wc2-word-card.md).
   */
  backTo?: { label: string; onBack: () => void } | undefined;
  /**
   * The word as the page has it and what kind of form it is ("moet", "now, hij/zij/het"): the
   * head is then the dictionary word, with this under it (RD2). Without it the line shows just
   * the page's word.
   */
  form?: { said: string; what?: string } | null | undefined;
  /**
   * The reader's word card as the mock (F2): with it, the tabs sit on top, the forms beside the
   * head, the meaning lines and related words before the actions, and the word's state and decks
   * become one quiet line at the bottom. Other screens leave it out and keep their layout.
   */
  card?: CardSlots | undefined;
  /** More about the word under its details (the reader's grammar of this word). */
  wordExtra?: ReactNode;
  /**
   * The Sentence tab (the sentence's translation, structure and "Explain"). With it, the details
   * have two tabs, Word and Sentence.
   */
  sentencePanel?: ReactNode;
}

/** The parts of the reader's word card (apps/web `WordEntry.tsx`). */
export interface CardSlots {
  /** The forms table, beside the head (under it on a phone). */
  forms?: ReactNode;
  /** One line under the head: "doet … open is one verb". */
  note?: ReactNode;
  /** The meaning line(s), in place of the short meaning and the meaning list. */
  meaning?: ReactNode;
  /** Related words, before the actions (not in the phone's peek). */
  related?: ReactNode;
  /** After the main buttons: Full entry, the level, Van Dale. */
  extra?: ReactNode;
}

/** Destination deck of Add to Anki with the picker's options. */
export interface AddDeckChoice {
  deck: string;
  options: readonly DeckOption[];
  onDeckChange: (deck: string) => void;
}

/** Parts of speech in plain words; tags without a plain name (X, PROPN, …) are not shown. */
const POS_NAME: Record<string, string> = {
  NOUN: "noun",
  VERB: "verb",
  AUX: "verb",
  ADJ: "adjective",
  ADV: "adverb",
  ADP: "preposition",
  PRON: "pronoun",
  DET: "article",
  NUM: "number",
  CCONJ: "conjunction",
  SCONJ: "conjunction",
  INTJ: "interjection",
};

/** "verb" for "VERB"; undefined for tags that mean nothing to a learner. */
export function posName(pos: string): string | undefined {
  return POS_NAME[pos.toUpperCase()];
}

/** Detail panel for the selected word: forms, glosses, state, source decks and context sentence. */
export function WordInspector({
  entry,
  onAddToAnki,
  onLearnNext,
  onMarkKnown,
  onReset,
  onUndo,
  undoLabel,
  busy = false,
  loading = false,
  error = null,
  onRetry,
  addDeck,
  emptyText = "Select a word in the text to see its details.",
  headerAction,
  backTo,
  form,
  card,
  wordExtra,
  sentencePanel,
}: WordInspectorProps) {
  const [tab, setTabNow] = useState<"word" | "sentence">("word");
  /** Which side the new tab's content slides in from (none on a new word). */
  const [enter, setEnter] = useState<"left" | "right" | null>(null);
  const setTab = (t: "word" | "sentence") => {
    if (t === tab) return;
    setEnter(t === "sentence" ? "right" : "left");
    setTabNow(t);
  };
  // A new word opens on its Word tab, not on the last word's Sentence tab.
  const shownId = entry ? `${entry.textId}:${entry.tokenIndex}:${entry.key}` : "";
  const [tabFor, setTabFor] = useState(shownId);
  if (tabFor !== shownId) {
    setTabFor(shownId);
    setTabNow("word");
    setEnter(null);
  }
  const swipe = useRef<{ x: number; y: number } | null>(null);
  if (!entry && error) {
    return (
      <div className="k-inspector" role="alert">
        <p style={{ margin: 0, color: "var(--danger)" }}>This word didn't load. {error}</p>
        {onRetry ? <Button onClick={onRetry}>Try again</Button> : null}
      </div>
    );
  }
  if (!entry && loading) {
    return (
      <p role="status" style={{ color: "var(--ink-muted)", margin: 0 }}>
        Loading the word
      </p>
    );
  }
  if (!entry) {
    return <p style={{ color: "var(--ink-muted)", margin: 0 }}>{emptyText}</p>;
  }
  const [from, to] = entry.sentenceHighlight;
  const s = entry.sentence;
  const recall = Math.round(entry.pKnown * 100);
  const pos = posName(entry.pos);

  const short = entry.glosses[0] ?? entry.sentenceGloss ?? null;
  // The head is the dictionary word; the page's form goes under it (RD2).
  const lemmaHead = !!form || entry.surface.toLocaleLowerCase() !== entry.lemma.toLocaleLowerCase();
  const actions = ankiActions({
    entry,
    busy,
    onAddToAnki,
    onLearnNext,
    onMarkKnown,
    onReset,
    onUndo,
    undoLabel,
    addDeck,
  });

  // On a touch screen a sideways swipe moves between the tabs, except where something scrolls
  // sideways itself (the sentence's rows).
  const swipeProps = sentencePanel
    ? {
        onTouchStart: (e: TouchEvent) => {
          const t = e.touches[0];
          let el = e.target as HTMLElement | null;
          for (; el && el !== e.currentTarget; el = el.parentElement)
            if (el.scrollWidth > el.clientWidth + 1) {
              const o = getComputedStyle(el).overflowX;
              if (o === "auto" || o === "scroll") break;
            }
          swipe.current =
            t && (!el || el === e.currentTarget) ? { x: t.clientX, y: t.clientY } : null;
        },
        onTouchEnd: (e: TouchEvent) => {
          const t = e.changedTouches[0];
          const from = swipe.current;
          swipe.current = null;
          if (!t || !from) return;
          const dx = t.clientX - from.x;
          if (Math.abs(dx) < 60 || Math.abs(t.clientY - from.y) > Math.abs(dx) / 2) return;
          setTab(dx < 0 ? "sentence" : "word");
        },
      }
    : {};

  const tabs = sentencePanel ? (
    <div className="k-inspector-tabs" role="tablist" aria-label="Details">
      <button
        type="button"
        role="tab"
        id="k-tab-word"
        aria-selected={tab === "word"}
        aria-controls="k-panel-word"
        onClick={() => setTab("word")}
      >
        Word
      </button>
      <button
        type="button"
        role="tab"
        id="k-tab-sentence"
        aria-selected={tab === "sentence"}
        aria-controls="k-panel-sentence"
        onClick={() => setTab("sentence")}
      >
        Sentence
      </button>
    </div>
  ) : null;

  // The reader's card on its Sentence tab: the tabs and the sentence, nothing of the word.
  if (card && sentencePanel && tab === "sentence") {
    return (
      <div
        className="k-inspector"
        data-layout="card"
        aria-label="Sentence details"
        {...(enter ? { "data-enter": enter } : {})}
        {...swipeProps}
      >
        {tabs}
        <div className="k-inspector-peek" />
        <div
          className="k-inspector-more"
          role="tabpanel"
          id="k-panel-sentence"
          aria-labelledby="k-tab-sentence"
        >
          {sentencePanel}
        </div>
      </div>
    );
  }

  // Two parts: the peek (the word, its short meaning, play, the two main buttons) and the
  // details. Below 900px the bottom sheet opens showing only the peek (useBottomSheet.ts); the
  // side panel lays both out as one column in the order it always had (styles.css).
  return (
    <div
      className="k-inspector"
      aria-label="Word details"
      {...(card ? { "data-layout": "card" } : {})}
      {...(card && enter ? { "data-enter": enter } : {})}
      {...(card ? swipeProps : {})}
    >
      {card && tabs}
      <div className="k-inspector-peek">
        {backTo ? (
          <button type="button" className="k-inspector-back" onClick={backTo.onBack}>
            ← <span lang="nl">{backTo.label}</span>
          </button>
        ) : null}
        <div className={card ? "k-card-top" : undefined}>
          <header>
            <div className="k-inspector-head">
              <h2 className="k-inspector-surface" lang="nl">
                {entry.article ? (
                  <>
                    <span style={{ color: "var(--ink-muted)" }}>{entry.article}</span>{" "}
                  </>
                ) : null}
                {lemmaHead ? entry.lemma : entry.surface}
              </h2>
              {headerAction}
            </div>
            {lemmaHead ? (
              <div className="k-inspector-lemma">
                <span lang="nl">{form?.said ?? entry.surface}</span>
                {form?.what ? ` · ${form.what}` : null}
              </div>
            ) : null}
            {card?.note}
          </header>
          {card?.forms}
        </div>
        {card ? (
          card.meaning
        ) : (
          /* The short meaning, drawn from its attribute (styles.css): the full list below is
             what screen readers and searches find, so the word is not said twice. */
          <p className="k-inspector-short" data-short={short ?? "No meaning yet"} aria-hidden />
        )}
        {s ? (
          <div
            className="k-inspector-context"
            /* On the card, the sentence opens the Sentence tab. */
            {...(card && sentencePanel
              ? {
                  role: "button",
                  tabIndex: 0,
                  "aria-label": "Open the Sentence tab",
                  "data-opens": "",
                  onClick: () => setTab("sentence"),
                  onKeyDown: (e: KeyboardEvent) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    setTab("sentence");
                  },
                }
              : {})}
          >
            <p className="k-inspector-sentence" lang="nl">
              {s.slice(0, from)}
              <mark>{s.slice(from, to)}</mark>
              {s.slice(to)}
            </p>
            {entry.sentenceTranslation ? (
              <p className="k-inspector-translation" lang="en">
                {entry.sentenceTranslation}
              </p>
            ) : null}
          </div>
        ) : null}
        {card?.related ? <div className="k-card-related">{card.related}</div> : null}
        {actions.quick}
        {card?.extra}
      </div>

      {!card && tabs}

      {sentencePanel && tab === "sentence" ? (
        <div
          className="k-inspector-more"
          role="tabpanel"
          id="k-panel-sentence"
          aria-labelledby="k-tab-sentence"
        >
          {sentencePanel}
        </div>
      ) : (
        <div
          className="k-inspector-more"
          {...(sentencePanel
            ? { role: "tabpanel", id: "k-panel-word", "aria-labelledby": "k-tab-word" }
            : {})}
        >
          {card ? null : (
            <>
              <div className="k-inspector-row">
                <WordStateChip state={entry.state} inVuurtoren={entry.appLearning} />
                {pos ? <span className="k-inspector-pos">{pos}</span> : null}
                {entry.state === "learning" ? (
                  <span className="k-recall" style={{ color: "var(--ink-muted)", fontSize: 13 }}>
                    Recall {recall}%
                  </span>
                ) : null}
              </div>

              {entry.glosses.length === 0 && !entry.sentenceGloss ? (
                <p className="k-inspector-nomeaning">No meaning yet</p>
              ) : (
                <section>
                  <div className="k-overline">Meaning</div>
                  <ul className="k-inspector-glosses">
                    {entry.glosses.map((g, i) => (
                      <li key={g}>
                        {g}
                        {i === 0 && entry.glossNote ? (
                          <span className="k-gloss-note"> · {entry.glossNote}</span>
                        ) : null}
                      </li>
                    ))}
                    {entry.sentenceGloss ? (
                      <li key="in-sentence">
                        {entry.sentenceGloss}
                        <span className="k-gloss-note"> · in this sentence</span>
                      </li>
                    ) : null}
                  </ul>
                </section>
              )}

              {entry.decks.length > 0 ? (
                <section>
                  <div className="k-overline">In your decks</div>
                  <div className="k-inspector-row" style={{ marginTop: 4 }}>
                    {entry.decks.map((d) => (
                      <Chip key={d} title={d}>
                        {deckName(d)}
                      </Chip>
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          )}
          {wordExtra}

          {card ? (
            <p className="k-card-quiet">
              <WordStateChip state={entry.state} inVuurtoren={entry.appLearning} />
              {pos ? <span className="k-inspector-pos">{pos}</span> : null}
              {entry.state === "learning" ? <span>Recall {recall}%</span> : null}
              {entry.decks.length ? (
                <span>
                  In your decks:{" "}
                  {entry.decks.map((d, k) => (
                    <span key={d} title={d}>
                      {k ? ", " : null}
                      {deckName(d)}
                    </span>
                  ))}
                </span>
              ) : null}
            </p>
          ) : null}

          {actions.details}
        </div>
      )}
    </div>
  );
}

const hintStyle = { margin: 0, color: "var(--ink-muted)", fontSize: 13 } as const;

const ANSWER = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" } as const;

/** Native mode: the word's latest answers, newest first, with the interval each gave. */
function ReviewList({ reviews }: { reviews: NonNullable<InspectorAnki["reviews"]> }) {
  return (
    <section>
      <div className="k-overline">Your reviews</div>
      <ul className="k-inspector-reviews">
        {reviews.map((r) => (
          <li key={`${r.at}-${r.rating}`}>
            <span>
              {new Date(r.at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
            </span>
            <span data-rating={r.rating}>{ANSWER[r.rating]}</span>
            <span className="k-inspector-review-ivl">{r.interval}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const STATUS_TEXT: Record<InspectorAnki["status"], string> = {
  absent: "Not in Anki",
  new: "New card",
  suspended: "Suspended",
  learning: "Learning",
  review: "In review",
  unavailable: "Anki not reachable",
};

const NATIVE_STATUS_TEXT: Record<InspectorAnki["status"], string> = {
  ...STATUS_TEXT,
  absent: "Not in your words",
  unavailable: "Card not available",
};

/**
 * The action buttons for the word's state in Anki (or its own card), in two parts: `quick`
 * (the main button and I know it, in the peek) and `details` (the card's status, its reviews
 * and Use Anki's state, or Stop ignoring for a word ignored earlier).
 */
function ankiActions({
  entry,
  busy = false,
  onAddToAnki,
  onLearnNext,
  onMarkKnown,
  onReset,
  onUndo,
  undoLabel = "✓ Added",
  addDeck,
}: Pick<
  WordInspectorProps,
  | "busy"
  | "onAddToAnki"
  | "onLearnNext"
  | "onMarkKnown"
  | "onReset"
  | "onUndo"
  | "undoLabel"
  | "addDeck"
> & { entry: InspectorEntry }): { quick: ReactNode; details: ReactNode } {
  const { anki } = entry;
  const { status } = anki;
  // Native mode: Vuurtoren's own cards, worded without Anki.
  const native = anki.native === true;
  const ADD = native ? "Add to my words" : "Add to Anki";
  const unavailable = status === "unavailable";
  const reason = anki.detail ?? "";
  const inProgress = status === "learning" || status === "review";
  // Words already known (mature in Anki, or marked) need no "I know it"; words not studied
  // yet always get it, because it also writes to Anki.
  const canMarkKnown = !anki.markedKnown && !(inProgress && entry.state === "known");
  const disabled = busy || unavailable;
  // Marked known by you (not learnt to maturity): it can always be taken back from the card.
  const markedKnown = entry.state === "known" && (anki.markedKnown || anki.overridden) === true;

  let primary: { label: string; onClick?: (() => void) | undefined } | null = null;
  if (status === "absent") {
    primary = { label: ADD, onClick: onAddToAnki };
  } else if (status === "new" || status === "suspended" || (unavailable && anki.noteIds.length)) {
    primary = {
      label:
        status === "suspended"
          ? "Unsuspend & study first"
          : native
            ? "Study first"
            : "Study first in Anki",
      onClick: onLearnNext,
    };
  } else if (unavailable) {
    primary = { label: ADD, onClick: onAddToAnki };
  }

  const quick =
    markedKnown && !onUndo && onReset ? (
      <div className="k-inspector-actions k-inspector-quick">
        <p className="k-inspector-added" role="status">
          ✓ Known
        </p>
        <Button disabled={busy} onClick={() => onReset()}>
          Learn it again
        </Button>
      </div>
    ) : onUndo ? (
      <div className="k-inspector-actions k-inspector-quick">
        <p className="k-inspector-added" role="status">
          {undoLabel}
        </p>
        <Button disabled={busy} onClick={onUndo}>
          Undo
        </Button>
      </div>
    ) : (
      <div className="k-inspector-actions k-inspector-quick">
        {primary && addDeck && primary.label === ADD ? (
          <AddToAnki
            native={native}
            deck={addDeck.deck}
            options={addDeck.options}
            onDeckChange={addDeck.onDeckChange}
            onAdd={() => primary.onClick?.()}
            disabled={disabled}
          />
        ) : primary ? (
          <Button variant="primary" disabled={disabled} onClick={() => primary.onClick?.()}>
            {primary.label}
          </Button>
        ) : null}
        {canMarkKnown ? (
          <Button disabled={disabled} onClick={() => onMarkKnown?.()}>
            I know it
          </Button>
        ) : null}
      </div>
    );

  const details = (
    <>
      {status !== "absent" ? (
        <section>
          <div className="k-overline">{native ? "Your card" : "In Anki"}</div>
          <p
            role={unavailable ? "alert" : "status"}
            style={unavailable ? { ...hintStyle, color: "var(--danger)" } : { margin: 0 }}
          >
            {unavailable
              ? `Anki not reachable${reason ? `. ${reason}` : ""}`
              : (anki.detail ?? (native ? NATIVE_STATUS_TEXT : STATUS_TEXT)[status])}
          </p>
        </section>
      ) : null}
      {anki.reviews?.length ? <ReviewList reviews={anki.reviews} /> : null}
      <div className="k-inspector-actions k-inspector-rest">
        {/* No Ignore button (m5): words ignored earlier can still be brought back here. */}
        {entry.state === "ignored" ? (
          <Button variant="ghost" disabled={busy} onClick={() => onReset?.()}>
            Stop ignoring
          </Button>
        ) : anki.overridden && !markedKnown ? (
          <Button variant="ghost" disabled={busy} onClick={() => onReset?.()}>
            {native ? "Use the card’s state" : "Use Anki’s state"}
          </Button>
        ) : null}
      </div>
    </>
  );
  return { quick, details };
}
