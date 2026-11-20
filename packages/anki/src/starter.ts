/**
 * Starter words in native mode: the most common Dutch words (`content/starter/nl-5000.json`) as
 * Vuurtoren's own cards, in levels of 500 ("Vuurtoren · Woorden 1–500" …). Notes are the same
 * type as Add to my words, new cards are ordered by rank, and a placement marks the words below
 * a rank known with the Mark known schedule.
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
  knownSchedule,
  normalizeKey,
} from "@app/core";
import type { RecordEvent } from "./commands.js";
import {
  type NativeCardsChangedEvent,
  type NativeWordAddedEvent,
  VUURTOREN_NOTETYPE,
} from "./native.js";
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
/** Levels added by default (1–3000). */
export const STARTER_CORE_LEVELS = 6;
/** All levels (1–5000); 7–10 are the extended levels. */
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

const levelOfRank = (rank: number) => Math.ceil(rank / STARTER_LEVEL_SIZE);

/** The learner-model key of a starter word. */
export const starterKey = (w: Pick<StarterWord, "word">) => normalizeKey(w.word);

/** A starter deck adds no new cards until it opens (`openStarterLevel`). */
const CLOSED: DeckOptions = { ...DEFAULT_DECK_OPTIONS, newPerDay: 0 };

function starterNote(w: StarterWord, tags: string[]): NativeNote {
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
  return note;
}

export interface AddStarterRequest {
  lang: string;
  /** The whole starter list, ranked. */
  words: readonly StarterWord[];
  /** Levels (1-based) whose words become new cards. */
  levels: readonly number[];
  /** Words up to this rank become known (placement): added as known, or their new cards marked. */
  knownThrough?: number;
  /** The cards the learner already has, by word key. */
  held: ReadonlyMap<string, readonly NativeCard[]>;
  /** Tags of the notes (the profile's tags). */
  tags?: readonly string[];
}

export interface AddStarterResult {
  /** New cards added. */
  added: number;
  /** Words marked known (added as known, or their new cards marked). */
  known: number;
  /** Words skipped because the learner already has them. */
  skipped: number;
  /** Decks that received notes. */
  decks: string[];
}

/**
 * Add starter levels and the placement as events: new notes in batches of 300 per
 * `NativeNotesAdded` (new decks start closed, see `openStarterLevel`), and one
 * `NativeCardsChanged` that marks known the new cards the learner already had below the
 * placement. Words already held are not added again.
 */
export async function addStarterWords(
  record: RecordEvent<NativeWordAddedEvent | NativeCardsChangedEvent>,
  req: AddStarterRequest,
  now: number = Date.now(),
): Promise<AddStarterResult> {
  const knownThrough = req.knownThrough ?? 0;
  const levels = new Set(req.levels);
  const tags = ["vuurtoren", ...(req.tags ?? []), "vuurtoren::starter"];
  const notes: NativeNote[] = [];
  const cards: NativeCard[] = [];
  const marks: NativeCardsChangedEvent["changes"] = [];
  let skipped = 0;
  let known = 0;
  let added = 0;
  for (const w of [...req.words].sort((a, b) => a.rank - b.rank)) {
    const asKnown = w.rank <= knownThrough;
    if (!asKnown && !levels.has(levelOfRank(w.rank))) continue;
    const held = req.held.get(starterKey(w));
    if (held?.length) {
      const fresh = held.filter((c) => !c.schedule);
      if (asKnown && fresh.length) {
        known++;
        for (const c of fresh)
          marks.push({ cardId: c.id, schedule: knownSchedule(undefined, now), suspended: false });
      } else skipped++;
      continue;
    }
    const note = starterNote(w, tags);
    const card: NativeCard = {
      id: note.id + 1,
      noteId: note.id,
      ord: 0,
      deck: starterDeck(levelOfRank(w.rank)),
      position: w.rank,
    };
    if (asKnown) {
      card.schedule = knownSchedule(undefined, now);
      known++;
    } else added++;
    notes.push(note);
    cards.push(card);
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
  }
  if (marks.length) {
    await record({ type: "NativeCardsChanged", lang: req.lang, reason: "known", changes: marks });
  }
  return { added, known, skipped, decks };
}

/**
 * Which starter deck to open: starter levels bring new cards one at a time, in order. When no
 * starter deck with new cards left adds any a day, the lowest such deck gets the usual new
 * cards a day. Null when nothing changes (one is open already, or none has new cards).
 */
export function openStarterLevel(
  decks: readonly { name: string; options: DeckOptions; fresh: number }[],
): { deck: string; options: DeckOptions } | null {
  const waiting = decks
    .filter((d) => d.fresh > 0 && starterLevelOf(d.name) !== null)
    .sort((a, b) => starterLevelOf(a.name)! - starterLevelOf(b.name)!);
  if (!waiting.length || waiting.some((d) => d.options.newPerDay > 0)) return null;
  const first = waiting[0]!;
  return {
    deck: first.name,
    options: { ...first.options, newPerDay: DEFAULT_DECK_OPTIONS.newPerDay },
  };
}

/** The levels a learner has, from their deck names. */
export function starterLevelsHeld(decks: readonly { name: string }[]): number[] {
  return decks
    .map((d) => starterLevelOf(d.name))
    .filter((l): l is number => l !== null)
    .sort((a, b) => a - b);
}
