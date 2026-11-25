import { type ReactNode, useState } from "react";
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
  /** More about the word under its details (the reader's grammar of this word). */
  wordExtra?: ReactNode;
  /**
   * The Sentence tab (the sentence's translation, structure and "Explain"). With it, the details
   * have two tabs, Word and Sentence.
   */
  sentencePanel?: ReactNode;
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
  busy = false,
  loading = false,
  error = null,
  onRetry,
  addDeck,
  emptyText = "Select a word in the text to see its details.",
  headerAction,
  backTo,
  form,
  wordExtra,
  sentencePanel,
}: WordInspectorProps) {
  const [tab, setTab] = useState<"word" | "sentence">("word");
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
  // The head is the dictionary word; the page's form goes under it (RD2).
  const lemmaHead = !!form || entry.surface.toLocaleLowerCase() !== entry.lemma.toLocaleLowerCase();
  const actions = ankiActions({
    entry,
    busy,
    onAddToAnki,
    onLearnNext,
    onMarkKnown,
    onReset,
    addDeck,
  });

  // Two parts: the peek (the word, its short meaning, play, the two main buttons) and the
  // details. Below 900px the bottom sheet opens showing only the peek (useBottomSheet.ts); the
  // side panel lays both out as one column in the order it always had (styles.css).
  return (
    <div className="k-inspector" aria-label="Word details">
      <div className="k-inspector-peek">
        {backTo ? (
          <button type="button" className="k-inspector-back" onClick={backTo.onBack}>
            ← <span lang="nl">{backTo.label}</span>
          </button>
        ) : null}
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
        </header>
        {/* The short meaning, drawn from its attribute (styles.css): the full list below is
            what screen readers and searches find, so the word is not said twice. */}
        <p className="k-inspector-short" data-short={short ?? "No meaning yet"} aria-hidden />
        {s ? (
          <div className="k-inspector-context">
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
        {actions.quick}
      </div>

      {sentencePanel ? (
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
      ) : null}

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

          {wordExtra}

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
  addDeck,
}: Pick<
  WordInspectorProps,
  "busy" | "onAddToAnki" | "onLearnNext" | "onMarkKnown" | "onReset" | "addDeck"
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
        {/* No Ignore button (m5): words ignored earlier can still be brought back here. */}
        {entry.state === "ignored" ? (
          <Button variant="ghost" disabled={busy} onClick={() => onReset?.()}>
            Stop ignoring
          </Button>
        ) : anki.overridden ? (
          <Button variant="ghost" disabled={busy} onClick={() => onReset?.()}>
            {native ? "Use the card’s state" : "Use Anki’s state"}
          </Button>
        ) : null}
      </div>
    </>
  );
  return { quick, details };
}
