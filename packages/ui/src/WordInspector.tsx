import type { WordState } from "@app/core";
import { Button } from "./Button.js";
import { Chip } from "./Chip.js";
import type { InspectorEntry } from "./types.js";

export interface WordInspectorProps {
  entry: InspectorEntry | null;
  onAddToAnki?: () => void;
  onSetState?: (state: WordState) => void;
  /** Disables the action buttons while a request is in flight. */
  busy?: boolean;
}

const STATE_LABEL: Record<WordState, string> = {
  unknown: "Not yet known",
  seen: "Seen",
  learning: "Learning",
  known: "Known",
  ignored: "Ignored",
};

/** Detail panel for the selected word: forms, glosses, state, source decks and context sentence. */
export function WordInspector({
  entry,
  onAddToAnki,
  onSetState,
  busy = false,
}: WordInspectorProps) {
  if (!entry) {
    return (
      <p style={{ color: "var(--ink-muted)", margin: 0 }}>
        Select a word in the text to see its details.
      </p>
    );
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
        <Chip>{entry.pos}</Chip>
        <Chip
          tone={
            entry.state === "known" ? "success" : entry.state === "learning" ? "accent" : "warm"
          }
        >
          {STATE_LABEL[entry.state]}
        </Chip>
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

      <section>
        <div className="k-overline">In context</div>
        <p className="k-inspector-sentence" lang="nl">
          {s.slice(0, from)}
          <mark>{s.slice(from, to)}</mark>
          {s.slice(to)}
        </p>
      </section>

      <div className="k-inspector-actions">
        <Button variant="primary" disabled={busy || entry.inAnki} onClick={() => onAddToAnki?.()}>
          {entry.inAnki ? "In Anki" : "Add to Anki"}
        </Button>
        <Button disabled={busy || entry.state === "known"} onClick={() => onSetState?.("known")}>
          Mark known
        </Button>
        <Button
          variant="ghost"
          disabled={busy || entry.state === "ignored"}
          onClick={() => onSetState?.("ignored")}
        >
          Ignore
        </Button>
      </div>
    </div>
  );
}
