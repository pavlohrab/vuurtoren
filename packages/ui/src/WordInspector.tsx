import type { ReactNode } from "react";
import type { WordState } from "@app/core";
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
  /** App-only states (Ignore). */
  onSetState?: ((state: WordState) => void) | undefined;
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
  onSetState,
  busy = false,
  loading = false,
  error = null,
  onRetry,
  addDeck,
  emptyText = "Select a word in the text to see its details.",
  headerAction,
}: WordInspectorProps) {
  if (!entry && error) {
    return (
      <div className="k-inspector" role="alert">
        <p style={{ margin: 0, color: "var(--danger)" }}>This word could not be loaded. {error}</p>
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
  const actions = ankiActions({
    entry,
    busy,
    onAddToAnki,
    onLearnNext,
    onMarkKnown,
    onReset,
    onSetState,
    addDeck,
  });

  // Two parts: the peek (the word, its short meaning, play, the two main buttons) and the
  // details. Below 900px the bottom sheet opens showing only the peek (useBottomSheet.ts); the
  // side panel lays both out as one column in the order it always had (styles.css).
  return (
    <div className="k-inspector" aria-label="Word details">
      <div className="k-inspector-peek">
        <header>
          <div className="k-inspector-head">
            <h2 className="k-inspector-surface" lang="nl">
              {entry.article ? (
                <>
                  <span style={{ color: "var(--ink-muted)" }}>{entry.article}</span>{" "}
                </>
              ) : null}
              {entry.surface}
            </h2>
            {headerAction}
          </div>
          {entry.surface.toLocaleLowerCase() !== entry.lemma.toLocaleLowerCase() ? (
            <div className="k-inspector-lemma">
              from <span lang="nl">{entry.lemma}</span>
            </div>
          ) : null}
        </header>
        {/* The short meaning, drawn from its attribute (styles.css): the full list below is
            what screen readers and searches find, so the word is not said twice. */}
        <p className="k-inspector-short" data-short={short ?? "No meaning yet"} aria-hidden />
        {actions.quick}
      </div>

      <div className="k-inspector-more">
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

        {s ? (
          <section>
            <div className="k-overline">In context</div>
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
          </section>
        ) : null}

        {actions.details}
      </div>
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
 * (the main button and I know it, in the peek) and `details` (the card's status, its reviews,
 * Ignore, the hints and Use Anki's state).
 */
function ankiActions({
  entry,
  busy = false,
  onAddToAnki,
  onLearnNext,
  onMarkKnown,
  onReset,
  onSetState,
  addDeck,
}: Pick<
  WordInspectorProps,
  "busy" | "onAddToAnki" | "onLearnNext" | "onMarkKnown" | "onReset" | "onSetState" | "addDeck"
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

  let primary: { label: string; hint?: string; onClick?: (() => void) | undefined } | null = null;
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
      hint: "Moves its card to the front of the queue",
      onClick: onLearnNext,
    };
  } else if (unavailable) {
    primary = { label: ADD, onClick: onAddToAnki };
  }

  const quick = (
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
        {primary?.hint && !unavailable ? <p style={hintStyle}>{primary.hint}</p> : null}
        <Button
          disabled={busy || entry.state === "ignored"}
          onClick={() => onSetState?.("ignored")}
        >
          {entry.state === "ignored" ? "Ignored" : "Ignore"}
        </Button>
        {canMarkKnown && status === "absent" ? (
          <p style={hintStyle}>
            &ldquo;I know it&rdquo;{" "}
            {native ? "adds it to your words as known" : "adds it to Anki as known"}. Ignore leaves
            it out of the counts and suggestions.
          </p>
        ) : null}
        {anki.overridden ? (
          <Button variant="ghost" disabled={busy} onClick={() => onReset?.()}>
            {native ? "Use the card’s state" : "Use Anki’s state"}
          </Button>
        ) : null}
      </div>
    </>
  );
  return { quick, details };
}
