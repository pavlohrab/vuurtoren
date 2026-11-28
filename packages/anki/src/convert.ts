/**
 * Make an Anki word note a Vuurtoren word note (Settings → Your words, mock
 * anki-to-vuurtoren.html). The note keeps its id, so its cards and their reviews stay. A word of
 * the starter list becomes the same note Vuurtoren makes for it (meaning, article, sentence,
 * recordings) and goes into its level deck; a rarer word gets the dictionary's meaning and goes
 * to Rarer words. The note's pictures are kept, on the back. Pure but for the clip ids.
 */
import {
  DEFAULT_DECK_OPTIONS,
  type DeckOptions,
  type NativeCard,
  type NativeNote,
  type NativeNotetype,
  escapeHtml,
  stripHtml,
} from "@app/core";
import { VUURTOREN_NOTETYPE } from "./native.js";
import { type StarterWord, starterDeck, starterLevelOfRank, starterNote } from "./starter.js";
import { clipId, wordClipText } from "./audio.js";

/** Where words beyond the starter list go. */
export const RARER_DECK = "Vuurtoren · Rarer words";

/** The pictures of a note's fields, as Anki writes them (`<img src="…">`). */
export function picturesOf(fields: readonly string[]): string {
  return fields.flatMap((f) => f.match(/<img\b[^>]*>/gi) ?? []).join(" ");
}

export interface Converted {
  note: NativeNote;
  deck: string;
}

/**
 * The Vuurtoren note for `note`: from the starter word when there is one, else from the
 * dictionary's meaning. Null when neither knows the word.
 */
export async function convertWordNote(
  note: NativeNote,
  starter: StarterWord | undefined,
  dict: { gloss: string; article?: string; zipf?: number } | undefined,
): Promise<Converted | null> {
  const picture = picturesOf(note.fields);
  const keep = { id: note.id, tags: note.tags };
  if (starter) {
    const made = await starterNote(starter, note.tags);
    return {
      note: { ...made, ...keep, fields: [...made.fields, picture] },
      deck: starterDeck(starterLevelOfRank(starter.rank)),
    };
  }
  if (!dict?.gloss || !note.key) return null;
  const word = note.key;
  const headword = dict.article && !dict.article.includes("/") ? `${dict.article} ${word}` : word;
  const made: NativeNote = {
    ...keep,
    notetypeId: VUURTOREN_NOTETYPE.id,
    fields: [escapeHtml(headword), escapeHtml(dict.gloss), "", "", "", picture],
    key: note.key,
    gloss: dict.gloss,
    audio: await clipId("word", wordClipText(word, dict.article)),
  };
  if (dict.article) made.article = dict.article;
  if (dict.zipf) made.zipf = dict.zipf;
  return { note: made, deck: RARER_DECK };
}

/**
 * Options of a deck the conversion makes: a level deck starts closed like the starter's (the
 * next level opens when one has no new cards left); Rarer words brings new cards as usual.
 */
export function convertedDeckOptions(name: string): DeckOptions {
  return name === RARER_DECK ? DEFAULT_DECK_OPTIONS : { ...DEFAULT_DECK_OPTIONS, newPerDay: 0 };
}

/** An Anki word note that can become a Vuurtoren word, with what it shows now. */
export interface WordToConvert {
  note: NativeNote;
  cards: NativeCard[];
  key: string;
  /** The note's word and meaning as its Anki fields have them. */
  word: string;
  gloss: string;
  hasPicture: boolean;
}

/**
 * The notes that can convert: word notes of an Anki note type (a word field, a key) whose cards
 * are one or two templates, so they map on Vuurtoren's Dutch → English and English → Dutch.
 * Sentence, grammar and cloze notes have no key, or are cloze, and stay as they are.
 */
export function wordsToConvert(col: {
  notetypes: readonly NativeNotetype[];
  notes: readonly NativeNote[];
  cards: readonly NativeCard[];
}): WordToConvert[] {
  const types = new Map(col.notetypes.map((t) => [t.id, t]));
  const cardsOf = new Map<number, NativeCard[]>();
  for (const c of col.cards) cardsOf.set(c.noteId, [...(cardsOf.get(c.noteId) ?? []), c]);
  const out: WordToConvert[] = [];
  for (const note of col.notes) {
    const type = types.get(note.notetypeId);
    const cards = cardsOf.get(note.id) ?? [];
    if (!type || type.id === VUURTOREN_NOTETYPE.id || type.kind !== "standard" || !type.vocab)
      continue;
    if (!note.key || !cards.length || cards.some((c) => c.ord > 1)) continue;
    const field = (name: string | undefined) => {
      const i = name ? type.fields.indexOf(name) : -1;
      return i < 0 ? "" : stripHtml(note.fields[i] ?? "").trim();
    };
    out.push({
      note,
      cards,
      key: note.key,
      word: field(type.vocab.word),
      gloss: field(type.vocab.gloss),
      hasPicture: picturesOf(note.fields) !== "",
    });
  }
  return out;
}

/** The Rarer words' groups, by wordfreq Zipf frequency (about the rank it stands for). */
export const RARER_GROUPS = [
  { label: "5,000–10,000", min: 3.5 },
  { label: "10,000–20,000", min: 3 },
  { label: "rarer", min: -Infinity },
] as const;

export const rarerGroupOf = (zipf: number) => RARER_GROUPS.find((g) => zipf >= g.min)!.label;

/**
 * Where a converted card goes in the new queue: a level word by its rank, a rarer word after
 * every starter word, more common first.
 */
export function convertedPosition(rank: number | undefined, zipf: number | undefined): number {
  return rank ?? 100_000 - Math.round((zipf ?? 0) * 1000);
}
