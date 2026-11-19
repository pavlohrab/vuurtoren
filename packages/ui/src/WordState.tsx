import type { WordState } from "@app/core";
import { cn } from "./cn.js";
import type { InspectorAnki } from "@app/core";

/**
 * Word states as the learner sees them.
 * `toLearn` is not a stored state: it marks the new words the reader suggests learning now.
 */
export type WordStateKind = WordState | "toLearn";

export const WORD_STATE_LABEL: Record<WordStateKind, string> = {
  known: "Known",
  learning: "Learning",
  toLearn: "To learn",
  unknown: "New",
  seen: "Seen",
  ignored: "Ignored",
};

const WORD_STATE_HINT: Record<WordStateKind, string> = {
  known: "You know this word",
  learning: "You are learning this word",
  toLearn: "A new word worth learning now; highlighted in the reader",
  unknown: "A word you have not learned yet",
  seen: "Met while reading, not learned yet",
  ignored: "Left out of coverage and suggestions",
};

/** Label of a word that is "learning" only because of answers given in Kenning. */
const IN_KENNING_LABEL = "Learning (in Kenning)";

export interface WordStateChipProps {
  state: WordStateKind;
  /** The state comes from answers in Kenning, not from Anki: "Learning (in Kenning)". */
  inKenning?: boolean | undefined;
  /** Show a count instead of the bare label, e.g. "3 to learn". */
  count?: number;
  className?: string;
}

/** The one chip for a word's state, used everywhere a state is shown. */
export function WordStateChip({ state, count, className, inKenning }: WordStateChipProps) {
  const appOnly = inKenning === true && state === "learning";
  const label = appOnly ? IN_KENNING_LABEL : WORD_STATE_LABEL[state];
  return (
    <span
      className={cn("k-chip", "k-state", `k-state--${state}`, className)}
      data-state={state}
      title={
        appOnly
          ? "You answered this word correctly in Kenning; it is not learned in Anki yet"
          : WORD_STATE_HINT[state]
      }
    >
      {count === undefined ? label : `${count.toLocaleString("en")} ${label.toLowerCase()}`}
    </span>
  );
}

export type AnkiStatus = InspectorAnki["status"];

/** A word's card in Anki, kept apart from the word state. */
const ANKI_STATUS_LABEL: Record<AnkiStatus, string> = {
  absent: "Not in Anki",
  new: "In Anki: new",
  learning: "In Anki: learning",
  review: "In Anki: review",
  suspended: "In Anki: suspended",
  unavailable: "Anki not reachable",
};

/** Chip for a word's Anki card status. */
export function AnkiStatusChip({ status, className }: { status: AnkiStatus; className?: string }) {
  return (
    <span className={cn("k-chip", "k-anki", `k-anki--${status}`, className)} data-status={status}>
      {ANKI_STATUS_LABEL[status]}
    </span>
  );
}

export interface LemmaProps {
  lemma: string;
  /** de / het; shown muted before the lemma. */
  article?: string | null | undefined;
  lang?: string;
  className?: string;
}

/** A headword in the reading font with its article muted. */
export function Lemma({ lemma, article, lang = "nl", className }: LemmaProps) {
  return (
    <span className={cn("k-lemma", className)} lang={lang}>
      {article ? <span className="k-lemma-article">{article} </span> : null}
      {lemma}
    </span>
  );
}
