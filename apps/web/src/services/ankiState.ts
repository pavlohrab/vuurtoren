/**
 * Turns the live Anki card status of a word (packages/anki `cardStatus`) into the
 * `InspectorEntry.anki` the inspector renders. Pure, so it is easy to test.
 */
import type { CardState, NoteCardStatus } from "@app/anki";
import type { WordInfo } from "@app/db";
import type { InspectorEntry } from "./types.js";

export type InspectorAnki = InspectorEntry["anki"];

/** Flags that come from the local database, not from Anki. */
function localFlags(
  info: WordInfo | null,
): Pick<InspectorAnki, "prioritized" | "markedKnown" | "overridden"> {
  return {
    prioritized: info?.prioritized ?? false,
    markedKnown: info?.markedKnownInAnki ?? false,
    overridden: info?.overridden ?? false,
  };
}

/** True if any card of the note has been studied (learning, review or relearning). */
const inProgress = (n: NoteCardStatus): boolean => n.cards.some((c) => c.type !== "new");

/** Most relevant card of a note: reviewed before learning before new. */
function bestCard(cards: CardState[]): CardState | undefined {
  const rank = (c: CardState) => (c.type === "review" ? 0 : c.type === "new" ? 2 : 1);
  return [...cards].sort((a, b) => rank(a) - rank(b))[0];
}

/**
 * The note to act on: the first note (the snapshot lists the exact headword first) that is
 * already being studied, otherwise the first note. Studying one note counts for the word.
 */
export function chooseNote(notes: NoteCardStatus[]): NoteCardStatus | undefined {
  return (
    notes.find((n) => n.cards.length > 0 && inProgress(n)) ?? notes.find((n) => n.cards.length > 0)
  );
}

/** State for a word with no matching note in Anki. */
export function absentAnki(info: WordInfo | null): InspectorAnki {
  return { status: "absent", noteIds: [], cardIds: [], ...localFlags(info) };
}

/** State when Anki could not be asked; the reason is shown to the user. */
export function unavailableAnki(info: WordInfo | null, reason: string): InspectorAnki {
  return {
    status: "unavailable",
    detail: reason,
    noteIds: info?.noteIds ?? [],
    cardIds: [],
    ...localFlags(info),
  };
}

/** State from the live status of the word's notes. */
export function ankiFromStatus(info: WordInfo | null, notes: NoteCardStatus[]): InspectorAnki {
  const note = chooseNote(notes);
  const card = note ? bestCard(note.cards) : undefined;
  if (!note || !card) return absentAnki(info);
  const base = {
    deck: note.deck,
    noteIds: [note.noteId],
    cardIds: note.cards.map((c) => c.cardId),
    ...localFlags(info),
  };
  if (card.type === "new") {
    const active = note.cards.some((c) => c.type === "new" && !c.suspended);
    if (!active) return { status: "suspended", detail: "Suspended", ...base };
    const buried = card.buried ? " · buried until tomorrow" : "";
    const where = base.prioritized ? `next in ${note.deck}` : `in ${note.deck}`;
    return { status: "new", detail: `New card · ${where}${buried}`, ...base };
  }
  const parts: string[] = [];
  if (card.type === "review") {
    parts.push("In review");
    if (card.dueText) parts.push(card.dueText);
  } else {
    parts.push(card.type === "relearning" ? "Relearning" : "Learning");
  }
  if (card.suspended) parts.push("suspended");
  return {
    status: card.type === "review" ? "review" : "learning",
    detail: parts.join(" · "),
    ...base,
  };
}
