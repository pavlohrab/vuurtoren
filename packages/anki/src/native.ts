/**
 * The word commands in native mode, next to their Anki versions: Add to my words, Mark known
 * and Study first act on the cards Vuurtoren holds, and record their events. `addWord`,
 * `markKnown` and `studyFirst` pick the right one for the profile's mode, so every caller
 * (reader, Words, Talk, courses, MCP) goes through one command layer.
 */
import {
  DEFAULT_DECK_OPTIONS,
  type NativeCard,
  escapeHtml,
  type NativeNote,
  type NativeNotetype,
  knownSchedule,
  noteTags,
  profileMode,
  resolveDeck,
  wordKey,
} from "@app/core";
import type { AnkiConnectClient } from "./client.js";
import {
  type CardsPrioritizedEvent,
  type MarkedKnownEvent,
  type RecordEvent,
  markWordKnown,
  studyWordFirst,
} from "./commands.js";
import {
  NOTE_BACK,
  NOTE_PRODUCTION_BACK,
  NOTE_PRODUCTION_FRONT,
  NOTE_CSS,
  NOTE_FIELDS,
  NOTE_FRONT,
  NOTE_TYPE,
  onlyBoldTags,
} from "./note.js";
import {
  type AddWordRequest,
  type AddWordResult,
  type NoteAddedEvent,
  addWordToAnki,
} from "./profile.js";

/** Vuurtoren's own vocabulary note type in native mode (the same fields as in Anki). */
export const VUURTOREN_NOTETYPE: NativeNotetype = {
  id: "vuurtoren-word",
  name: NOTE_TYPE,
  kind: "standard",
  fields: [...NOTE_FIELDS],
  templates: [
    { name: "Recognition", front: NOTE_FRONT, back: NOTE_BACK },
    // Its cards are made only with English → Dutch on (liveNative `syncReverse`).
    { name: "Production", front: NOTE_PRODUCTION_FRONT, back: NOTE_PRODUCTION_BACK },
  ],
  css: NOTE_CSS,
  vocab: {
    word: "Word",
    gloss: "Gloss",
    sentence: "Sentence",
    sentenceTranslation: "SentenceTranslation",
  },
};

/** Structurally the @app/db NativeNotesAdded event of one word. */
export interface NativeWordAddedEvent {
  type: "NativeNotesAdded";
  lang: string;
  origin: "vuurtoren";
  notetypes: NativeNotetype[];
  decks: { name: string; options: typeof DEFAULT_DECK_OPTIONS }[];
  notes: NativeNote[];
  cards: NativeCard[];
}

/** Structurally the @app/db NativeCardsChanged event. */
export interface NativeCardsChangedEvent {
  type: "NativeCardsChanged";
  lang: string;
  reason: "known" | "first";
  changes: {
    cardId: number;
    schedule?: ReturnType<typeof knownSchedule>;
    suspended?: boolean;
    position?: number;
  }[];
}

let lastId = 0;
/** A new note or card id: milliseconds like Anki's, strictly increasing. */
export function nextNativeId(now: number = Date.now()): number {
  lastId = Math.max(now, lastId + 1);
  return lastId;
}

/** Add to my words: a note of Vuurtoren's type with one card, in the profile's deck. */
export async function addWordToMyWords(
  record: RecordEvent<NativeWordAddedEvent>,
  req: AddWordRequest,
  now: number = Date.now(),
): Promise<AddWordResult> {
  const word = req.word.trim();
  if (!word) throw new Error("The word is empty");
  const { profile } = req;
  const deck = resolveDeck(profile, req.context);
  const key = wordKey(profile.lang, word, req.key);
  const noteId = nextNativeId(now);
  const cardId = nextNativeId(now);
  const gloss = req.gloss?.trim() ?? "";
  const note: NativeNote = {
    id: noteId,
    notetypeId: VUURTOREN_NOTETYPE.id,
    fields: [
      escapeHtml(word),
      escapeHtml(gloss),
      onlyBoldTags(req.sentence?.trim() ?? ""),
      escapeHtml(req.sentenceTranslation ?? ""),
      escapeHtml(req.source ?? ""),
    ],
    tags: ["vuurtoren", ...noteTags(profile, req.context.source, req.extraTags)],
    key,
    ...(gloss ? { gloss } : {}),
  };
  const sentence = req.sentence?.replace(/<[^>]*>/g, "").trim();
  if (sentence) note.sentence = sentence;
  if (sentence && req.sentenceTranslation) note.sentenceTranslation = req.sentenceTranslation;
  const card: NativeCard = { id: cardId, noteId, ord: 0, deck, position: -now };
  if (req.asKnown) card.schedule = knownSchedule(undefined, now);
  await record({
    type: "NativeNotesAdded",
    lang: profile.lang,
    origin: "vuurtoren",
    notetypes: [VUURTOREN_NOTETYPE],
    decks: [{ name: deck, options: DEFAULT_DECK_OPTIONS }],
    notes: [note],
    cards: [card],
  });
  return { noteId, deck, key, cardIds: req.asKnown ? [cardId] : [] };
}

/** Structurally the @app/db NativeNotesRemoved event. */
export interface NativeWordRemovedEvent {
  type: "NativeNotesRemoved";
  lang: string;
  noteIds: number[];
}

/** Undo right after Add to my words: the note goes, with its card. */
export async function removeNativeWord(
  record: RecordEvent<NativeWordRemovedEvent>,
  req: { lang: string; noteId: number },
): Promise<void> {
  await record({ type: "NativeNotesRemoved", lang: req.lang, noteIds: [req.noteId] });
}

/** Add to Anki (connected) or Add to my words (native), by the profile's mode. */
export async function addWord(
  anki: () => Promise<AnkiConnectClient>,
  record: RecordEvent<NoteAddedEvent | NativeWordAddedEvent>,
  req: AddWordRequest,
): Promise<AddWordResult> {
  if (profileMode(req.profile) === "native") return addWordToMyWords(record, req);
  return addWordToAnki(await anki(), record, req);
}

/** Mark known in native mode: the cards get a mature interval (or the word is added as known). */
export async function markNativeKnown(
  record: RecordEvent<NativeCardsChangedEvent | NativeWordAddedEvent>,
  req: { lang: string; key: string; cardIds: number[]; add?: AddWordRequest },
  now: number = Date.now(),
): Promise<{ key: string; addedToDeck?: string; addedNoteId?: number }> {
  if (req.cardIds.length === 0) {
    if (!req.add) throw new Error("This word is not in your words");
    const added = await addWordToMyWords(
      record,
      { ...req.add, key: req.add.key ?? req.key, asKnown: true },
      now,
    );
    return { key: added.key, addedToDeck: added.deck, addedNoteId: added.noteId };
  }
  await record({
    type: "NativeCardsChanged",
    lang: req.lang,
    reason: "known",
    changes: req.cardIds.map((cardId) => ({
      cardId,
      schedule: knownSchedule(undefined, now),
      suspended: false,
    })),
  });
  return { key: wordKey(req.lang, req.key, req.key) };
}

/** Study first in native mode: the new cards go to the front of the new queue, unsuspended. */
export async function studyNativeFirst(
  record: RecordEvent<NativeCardsChangedEvent>,
  req: { lang: string; cardIds: number[] },
  now: number = Date.now(),
): Promise<void> {
  if (req.cardIds.length === 0) throw new Error("This word has no new card");
  await record({
    type: "NativeCardsChanged",
    lang: req.lang,
    reason: "first",
    changes: req.cardIds.map((cardId, i) => ({ cardId, position: -now + i, suspended: false })),
  });
}

/** Mark known for either mode. */
export async function markKnown(
  native: boolean,
  anki: () => Promise<AnkiConnectClient>,
  record: RecordEvent<
    MarkedKnownEvent | NoteAddedEvent | NativeCardsChangedEvent | NativeWordAddedEvent
  >,
  req: { lang: string; key: string; noteIds: number[]; cardIds: number[]; add?: AddWordRequest },
): Promise<{ key: string; addedToDeck?: string; addedNoteId?: number }> {
  if (native) return markNativeKnown(record, req);
  return markWordKnown(await anki(), record, req);
}

/** Study first for either mode. */
export async function studyFirst(
  native: boolean,
  anki: () => Promise<AnkiConnectClient>,
  record: RecordEvent<CardsPrioritizedEvent | NativeCardsChangedEvent>,
  req: { lang: string; key: string; noteId: number; cardIds: number[] },
): Promise<void> {
  if (native) return studyNativeFirst(record, req);
  await studyWordFirst(await anki(), record, req);
}
