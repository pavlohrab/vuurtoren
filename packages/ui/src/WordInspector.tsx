import type { WordState } from "@app/core";
import { AddToAnki, type DeckOption } from "./AddToAnki.js";
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
}

/** Destination deck of Add to Anki with the picker's options. */
export interface AddDeckChoice {
  deck: string;
  options: readonly DeckOption[];
  onDeckChange: (deck: string) => void;
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

  return (
    <div className="k-inspector" aria-label="Word details">
      <header>
        <h2 className="k-inspector-surface" lang="nl">
          {entry.article ? (
            <>
              <span style={{ color: "var(--ink-muted)" }}>{entry.article}</span>{" "}
            </>
          ) : null}
          {entry.surface}
        </h2>
        {entry.surface.toLocaleLowerCase() !== entry.lemma.toLocaleLowerCase() ? (
          <div className="k-inspector-lemma">
            from <span lang="nl">{entry.lemma}</span>
          </div>
        ) : null}
      </header>

      <div className="k-inspector-row">
        {entry.pos ? <Chip>{entry.pos}</Chip> : null}
        <WordStateChip state={entry.state} inKenning={entry.appLearning} />
        <span className="k-recall" style={{ color: "var(--ink-muted)", fontSize: 13 }}>
          Recall {recall}%
        </span>
      </div>

      {entry.glosses.length > 0 ? (
        <section>
          <div className="k-overline">Meaning</div>
          <ul className="k-inspector-glosses">
            {entry.glosses.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {entry.decks.length > 0 ? (
        <section>
          <div className="k-overline">In your decks</div>
          <div className="k-inspector-row" style={{ marginTop: 4 }}>
            {entry.decks.map((d) => (
              <Chip key={d}>{d}</Chip>
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

      <AnkiActions
        entry={entry}
        busy={busy}
        onAddToAnki={onAddToAnki}
        onLearnNext={onLearnNext}
        onMarkKnown={onMarkKnown}
        onReset={onReset}
        onSetState={onSetState}
        addDeck={addDeck}
      />
    </div>
  );
}

const hintStyle = { margin: 0, color: "var(--ink-muted)", fontSize: 13 } as const;

const STATUS_TEXT: Record<InspectorAnki["status"], string> = {
  absent: "Not in Anki",
  new: "New card",
  suspended: "Suspended",
  learning: "Learning",
  review: "In review",
  unavailable: "Anki not reachable",
};

/** Status line and action buttons for the word's state in Anki. */
function AnkiActions({
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
> & { entry: InspectorEntry }) {
  const { anki } = entry;
  const { status } = anki;
  const unavailable = status === "unavailable";
  const reason = anki.detail ?? "";
  const inProgress = status === "learning" || status === "review";
  // Words already known (mature in Anki, or marked) need no "Mark known"; words not studied
  // yet always get it, because it also writes to Anki.
  const canMarkKnown = !anki.markedKnown && !(inProgress && entry.state === "known");
  const disabled = busy || unavailable;
  const deck = anki.deck ?? entry.decks[0];

  let primary: { label: string; hint?: string; onClick?: (() => void) | undefined } | null = null;
  if (status === "absent") {
    primary = {
      label: "Add to Anki",
      hint: addDeck ? `Adds it to ‘${addDeck.deck}’` : "Adds it to your Kenning deck",
      onClick: onAddToAnki,
    };
  } else if (status === "new" || status === "suspended" || (unavailable && anki.noteIds.length)) {
    primary = {
      label: status === "suspended" ? "Unsuspend & study first" : "Study first in Anki",
      hint: deck ? `Moves its card to the front of ‘${deck}’` : "Moves its card to the front",
      onClick: onLearnNext,
    };
  } else if (unavailable) {
    primary = { label: "Add to Anki", onClick: onAddToAnki };
  }

  return (
    <>
      {status !== "absent" ? (
        <section>
          <div className="k-overline">In Anki</div>
          <p
            role={unavailable ? "alert" : "status"}
            style={unavailable ? { ...hintStyle, color: "var(--danger)" } : { margin: 0 }}
          >
            {unavailable
              ? `Anki not reachable${reason ? `. ${reason}` : ""}`
              : (anki.detail ?? STATUS_TEXT[status])}
          </p>
        </section>
      ) : null}
      <div className="k-inspector-actions">
        {primary && addDeck && primary.label === "Add to Anki" ? (
          <AddToAnki
            deck={addDeck.deck}
            options={addDeck.options}
            onDeckChange={addDeck.onDeckChange}
            onAdd={() => primary.onClick?.()}
            disabled={disabled}
          />
        ) : primary ? (
          <>
            <Button variant="primary" disabled={disabled} onClick={() => primary.onClick?.()}>
              {primary.label}
            </Button>
            {primary.hint && !unavailable ? <p style={hintStyle}>{primary.hint}</p> : null}
          </>
        ) : null}
        <div className="k-inspector-secondary">
          {canMarkKnown ? (
            <Button disabled={disabled} onClick={() => onMarkKnown?.()}>
              Mark known
            </Button>
          ) : null}
          <Button
            disabled={busy || entry.state === "ignored"}
            onClick={() => onSetState?.("ignored")}
          >
            {entry.state === "ignored" ? "Ignored" : "Ignore"}
          </Button>
        </div>
        {canMarkKnown && status === "absent" ? (
          <p style={hintStyle}>
            Mark known{" "}
            {addDeck ? `adds it to ‘${addDeck.deck}’ as known` : "adds it to Anki as known"}. Ignore
            leaves it out of coverage and suggestions.
          </p>
        ) : null}
        {anki.overridden ? (
          <Button variant="ghost" disabled={busy} onClick={() => onReset?.()}>
            Use Anki&rsquo;s state
          </Button>
        ) : null}
      </div>
    </>
  );
}
