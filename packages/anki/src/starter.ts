/**
 * Starter words in native mode: the most common Dutch words (`content/starter/nl-5000.json`) as
 * Vuurtoren's own cards, in levels of 500 ("Vuurtoren · Woorden 1–500" …). Notes are the same
 * type as Add to my words and new cards are ordered by rank. Nothing is marked known here: the
 * reader's evidence does that as the learner reads.
 *
 * Idempotent: a word the learner already has a card for is skipped, and starter notes and cards
 * have fixed ids (from the rank), so adding a level twice, or on two devices before they sync,
 * gives the same cards once.
 */
import {
  DEFAULT_DECK_OPTIONS,
  type DeckOptions,
  type NativeCard,
  type NativeNote,
  escapeHtml,
  normalizeKey,
} from "@app/core";
import type { RecordEvent } from "./commands.js";
import { type NativeWordAddedEvent, VUURTOREN_NOTETYPE } from "./native.js";
import { clipId, wordClipText } from "./audio.js";
import { highlightSentence } from "./note.js";

/** One word of the starter list. */
export interface StarterWord {
  /** 1 = most common. */
  rank: number;
  word: string;
  pos: string;
  /** de, het or de/het (nouns). */
  article?: string;
  gloss: string;
  sentence?: string;
  translation?: string;
  /** Where the word is in the sentence (UTF-16 offsets). */
  mark?: [number, number];
  /** Tatoeba sentence id. */
  tatoeba?: number;
}

export const STARTER_LEVEL_SIZE = 500;
/** All levels: the list's words in levels of 500 (the last one may be shorter). */
export const STARTER_LEVELS = 10;
/** Notes per event, as in a package import. */
const NOTES_PER_EVENT = 300;
/** Starter ids: rank × 2 (note) and + 1 (card) above this; Anki ids (ms since 2006) are larger. */
const STARTER_ID_BASE = 1_000_000_000_000;
const DECK_PREFIX = "Vuurtoren · Woorden ";

/** The deck of a level (1-based): "Vuurtoren · Woorden 1–500". */
export function starterDeck(level: number): string {
  const from = (level - 1) * STARTER_LEVEL_SIZE + 1;
  return `${DECK_PREFIX}${from}–${level * STARTER_LEVEL_SIZE}`;
}

/** The level of a starter deck name, or null for other decks. */
export function starterLevelOf(deck: string): number | null {
  if (!deck.startsWith(DECK_PREFIX)) return null;
  const m = /^(\d+)–(\d+)$/.exec(deck.slice(DECK_PREFIX.length));
  if (!m) return null;
  const to = Number(m[2]);
  return to % STARTER_LEVEL_SIZE === 0 ? to / STARTER_LEVEL_SIZE : null;
}

/** The level (1-based) of a starter word's rank: ranks 1–500 are level 1. */
export const starterLevelOfRank = (rank: number) => Math.ceil(rank / STARTER_LEVEL_SIZE);

/** The learner-model key of a starter word. */
export const starterKey = (w: Pick<StarterWord, "word">) => normalizeKey(w.word);

/** A starter deck adds no new cards until it opens (`openStarterLevel`). */
const CLOSED: DeckOptions = { ...DEFAULT_DECK_OPTIONS, newPerDay: 0 };

async function starterNote(w: StarterWord, tags: string[]): Promise<NativeNote> {
  const single = w.article && !w.article.includes("/") ? w.article : undefined;
  const headword = single ? `${single} ${w.word}` : w.word;
  const sentence =
    w.sentence && w.mark ? highlightSentence(w.sentence, w.mark[0], w.mark[1]) : (w.sentence ?? "");
  const note: NativeNote = {
    id: STARTER_ID_BASE + w.rank * 2,
    notetypeId: VUURTOREN_NOTETYPE.id,
    fields: [
      escapeHtml(headword),
      escapeHtml(w.gloss),
      w.sentence && w.mark ? sentence : escapeHtml(sentence),
      escapeHtml(w.translation ?? ""),
      escapeHtml(w.tatoeba ? `Tatoeba #${w.tatoeba}` : ""),
    ],
    tags,
    key: starterKey(w),
    gloss: w.gloss,
  };
  if (w.article) note.article = w.article;
  if (w.sentence) note.sentence = w.sentence;
  if (w.sentence && w.translation) note.sentenceTranslation = w.translation;
  // The clips' ids from the texts they say (as server/nlp/scripts/tts_elevenlabs.py names them),
  // kept so that editing the note later does not lose its sound.
  note.audio = await clipId("word", wordClipText(w.word, w.article));
  if (w.sentence) note.sentenceAudio = await clipId("sentence", w.sentence);
  return note;
}

export interface AddStarterRequest {
  lang: string;
  /** The whole starter list, ranked. */
  words: readonly StarterWord[];
  /** Levels (1-based) whose words become new cards. */
  levels: readonly number[];
  /** The cards the learner already has, by word key. */
  held: ReadonlyMap<string, readonly NativeCard[]>;
  /** Tags of the notes (the profile's tags). */
  tags?: readonly string[];
  /** After each batch of notes is stored: how many so far, of how many. */
  onProgress?: (done: number, total: number) => void;
}

export interface AddStarterResult {
  /** New cards added. */
  added: number;
  /** Words skipped because the learner already has them. */
  skipped: number;
  /** Decks that received notes. */
  decks: string[];
}

/**
 * Add starter levels as events: new notes in batches of 300 per `NativeNotesAdded`; new decks
 * start closed (see `openStarterLevel`). Words already held are not added again.
 */
export async function addStarterWords(
  record: RecordEvent<NativeWordAddedEvent>,
  req: AddStarterRequest,
): Promise<AddStarterResult> {
  const levels = new Set(req.levels);
  const tags = ["vuurtoren", ...(req.tags ?? []), "vuurtoren::starter"];
  const notes: NativeNote[] = [];
  const cards: NativeCard[] = [];
  let skipped = 0;
  for (const w of [...req.words].sort((a, b) => a.rank - b.rank)) {
    if (!levels.has(starterLevelOfRank(w.rank))) continue;
    if (req.held.get(starterKey(w))?.length) {
      skipped++;
      continue;
    }
    const note = await starterNote(w, tags);
    notes.push(note);
    cards.push({
      id: note.id + 1,
      noteId: note.id,
      ord: 0,
      deck: starterDeck(starterLevelOfRank(w.rank)),
      position: w.rank,
    });
  }
  const decks = [...new Set(cards.map((c) => c.deck))];
  for (let i = 0; i < notes.length; i += NOTES_PER_EVENT) {
    const chunk = cards.slice(i, i + NOTES_PER_EVENT);
    await record({
      type: "NativeNotesAdded",
      lang: req.lang,
      origin: "vuurtoren",
      notetypes: [VUURTOREN_NOTETYPE],
      decks: [...new Set(chunk.map((c) => c.deck))].map((name) => ({ name, options: CLOSED })),
      notes: notes.slice(i, i + NOTES_PER_EVENT),
      cards: chunk,
    });
    req.onProgress?.(Math.min(notes.length, i + NOTES_PER_EVENT), notes.length);
  }
  return { added: notes.length, skipped, decks };
}

type StarterDeckState = { name: string; options: DeckOptions; fresh: number };

/** Starter decks with new cards left, lowest level first. */
function waitingLevels(decks: readonly StarterDeckState[]) {
  return decks
    .map((d) => ({ ...d, level: starterLevelOf(d.name) }))
    .filter((d): d is StarterDeckState & { level: number } => d.fresh > 0 && d.level !== null)
    .sort((a, b) => a.level - b.level);
}

const opened = (d: StarterDeckState) => ({
  deck: d.name,
  options: { ...d.options, newPerDay: DEFAULT_DECK_OPTIONS.newPerDay },
});

/**
 * Which starter deck to open: starter levels bring new cards one at a time, in order, from the
 * learner's start level (`from`; the levels below it get no new cards). When no starter deck
 * from there with new cards left adds any a day, the lowest such deck gets the usual new cards
 * a day. Null when nothing changes (one is open already, or none has new cards).
 */
export function openStarterLevel(
  decks: readonly StarterDeckState[],
  from = 1,
): { deck: string; options: DeckOptions } | null {
  const waiting = waitingLevels(decks).filter((d) => d.level >= from);
  if (!waiting.length || waiting.some((d) => d.options.newPerDay > 0)) return null;
  return opened(waiting[0]!);
}

/**
 * A new start level: the first level from `from` with new cards left opens now, and every other
 * starter deck that adds new cards closes, so one level at a time still holds.
 */
export function startStarterFrom(
  decks: readonly StarterDeckState[],
  from: number,
): { deck: string; options: DeckOptions }[] {
  const waiting = waitingLevels(decks);
  const first = waiting.find((d) => d.level >= from);
  const changes = waiting
    .filter((d) => d !== first && d.options.newPerDay > 0)
    .map((d) => ({ deck: d.name, options: { ...d.options, newPerDay: 0 } }));
  if (first && first.options.newPerDay === 0) changes.push(opened(first));
  return changes;
}

/** The levels a learner has, from their deck names. */
export function starterLevelsHeld(decks: readonly { name: string }[]): number[] {
  return decks
    .map((d) => starterLevelOf(d.name))
    .filter((l): l is number => l !== null)
    .sort((a, b) => a - b);
}
