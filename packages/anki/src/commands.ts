/**
 * The word commands shared by every caller (web reader, Words from this text, course units, MCP,
 * later Tauri and the extension): Study first in Anki (learn next), Mark known, Use Anki's state
 * and app-only states, next to `addWordToAnki` (profile.ts). Each one acts on Anki only when the
 * user clicked it (ADR 0007), and records its event with the one key rule (`wordKey`).
 * Platform-neutral: needs an AnkiConnect client and a callback that records the event.
 */
import { type WordState, wordKey } from "@app/core";
import { cardStatus, learnNext, markKnownInAnki } from "./actions.js";
import type { AnkiConnectClient } from "./client.js";
import { type AddWordRequest, type NoteAddedEvent, addWordToAnki } from "./profile.js";

/** "Study first in Anki" moved these cards (structurally an @app/db AppEvent). */
export interface CardsPrioritizedEvent {
  type: "CardsPrioritized";
  lang: string;
  key: string;
  noteId: number;
  cardIds: number[];
  unsuspended: number[];
}

/** "Mark known" rescheduled these cards as known in Anki. */
export interface MarkedKnownEvent {
  type: "MarkedKnownInAnki";
  lang: string;
  key: string;
  noteIds: number[];
  cardIds: number[];
}

/** App-only word state (Ignore, placement marks). */
export interface WordStateSetEvent {
  type: "WordStateSet";
  lang: string;
  key: string;
  state: WordState;
}

/** "Use Anki's state": drop the manual state. */
export interface WordStateClearedEvent {
  type: "WordStateCleared";
  lang: string;
  key: string;
}

export type WordCommandEvent =
  | NoteAddedEvent
  | CardsPrioritizedEvent
  | MarkedKnownEvent
  | WordStateSetEvent
  | WordStateClearedEvent;

export type RecordEvent<E = WordCommandEvent> = (e: E) => Promise<unknown>;

/** The key every command records: the analysed key, normalised (see `wordKey`). */
const keyOf = (lang: string, key: string): string => wordKey(lang, key, key);

/**
 * Study first in Anki for one word whose card ids the caller already has (reader inspector):
 * move its new cards to the front of their deck's queue (unsuspending them).
 * @throws when none of the cards is new any more
 */
export async function studyWordFirst(
  anki: AnkiConnectClient,
  record: RecordEvent<CardsPrioritizedEvent>,
  req: { lang: string; key: string; noteId: number; cardIds: number[] },
): Promise<{ cardIds: number[]; unsuspended: number[] }> {
  const { repositioned, unsuspended } = await learnNext(anki, req.cardIds);
  if (repositioned.length === 0) throw new Error("Its card is no longer new in Anki");
  await record({
    type: "CardsPrioritized",
    lang: req.lang,
    key: keyOf(req.lang, req.key),
    noteId: req.noteId,
    cardIds: repositioned,
    unsuspended,
  });
  return { cardIds: repositioned, unsuspended };
}

/**
 * Study first in Anki for several words (a course unit), in the given order so Anki introduces
 * them as the book does. Only new cards move; words without one are skipped.
 * @returns how many words had cards moved
 */
export async function studyWordsFirst(
  anki: AnkiConnectClient,
  record: RecordEvent<CardsPrioritizedEvent>,
  lang: string,
  words: readonly { key: string; noteIds: readonly number[] }[],
): Promise<{ moved: number }> {
  const noteIds = [...new Set(words.flatMap((w) => w.noteIds))];
  if (noteIds.length === 0) return { moved: 0 };
  const { notes } = await cardStatus(anki, noteIds);
  const newCards = new Map<number, number[]>(); // noteId -> new card ids
  for (const note of notes) {
    const fresh = note.cards.filter((c) => c.type === "new").map((c) => c.cardId);
    if (fresh.length > 0) newCards.set(note.noteId, fresh);
  }
  const cardIds = [
    ...new Set(words.flatMap((w) => w.noteIds.flatMap((id) => newCards.get(id) ?? []))),
  ];
  if (cardIds.length === 0) return { moved: 0 };
  const { repositioned, unsuspended } = await learnNext(anki, cardIds);
  const moved = new Set(repositioned);
  let count = 0;
  for (const w of words) {
    const noteId = w.noteIds.find((id) => (newCards.get(id) ?? []).some((c) => moved.has(c)));
    if (noteId === undefined) continue;
    const ids = (newCards.get(noteId) ?? []).filter((c) => moved.has(c));
    await record({
      type: "CardsPrioritized",
      lang,
      key: keyOf(lang, w.key),
      noteId,
      cardIds: ids,
      unsuspended: ids.filter((c) => unsuspended.includes(c)),
    });
    count++;
  }
  return { moved: count };
}

export interface MarkKnownRequest {
  lang: string;
  key: string;
  /** The word's notes and cards in Anki (empty when it is not in Anki). */
  noteIds: number[];
  cardIds: number[];
  /** How to add the word when it has no cards (Mark known adds it first). */
  add?: AddWordRequest;
}

/**
 * Mark known: give the word's cards a mature interval in Anki, or add the word first when it has
 * none (ADR 0007), then record `MarkedKnownInAnki`.
 */
export async function markWordKnown(
  anki: AnkiConnectClient,
  record: RecordEvent<MarkedKnownEvent | NoteAddedEvent>,
  req: MarkKnownRequest,
): Promise<{ key: string; addedToDeck?: string }> {
  let { noteIds, cardIds } = req;
  let key = keyOf(req.lang, req.key);
  let addedToDeck: string | undefined;
  if (cardIds.length > 0) {
    await markKnownInAnki(anki, cardIds);
  } else {
    if (!req.add) throw new Error("This word is not in Anki");
    const added = await addWordToAnki(anki, record, {
      ...req.add,
      key: req.add.key ?? req.key,
      asKnown: true,
    });
    noteIds = [added.noteId];
    cardIds = added.cardIds;
    key = added.key;
    addedToDeck = added.deck;
  }
  await record({ type: "MarkedKnownInAnki", lang: req.lang, key, noteIds, cardIds });
  return addedToDeck ? { key, addedToDeck } : { key };
}

/** Use Anki's state: drop the manual state (app-side only; Anki is not touched). */
export async function resetToAnkiState(
  record: RecordEvent<WordStateClearedEvent>,
  lang: string,
  key: string,
): Promise<void> {
  await record({ type: "WordStateCleared", lang, key: keyOf(lang, key) });
}

/** An app-only state (Ignore, placement marks); never written to Anki. */
export async function setAppWordState(
  record: RecordEvent<WordStateSetEvent>,
  lang: string,
  key: string,
  state: WordState,
): Promise<void> {
  await record({ type: "WordStateSet", lang, key: keyOf(lang, key), state });
}
