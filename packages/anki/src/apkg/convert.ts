/**
 * From an Anki collection (read from a package file or from AnkiConnect) to Vuurtoren's own cards:
 * the chosen decks' notes, cards and review history, with vocabulary fields detected the same
 * way as in connected mode and every reviewed card's memory rebuilt by replaying its history.
 * Notes and cards keep their Anki ids.
 */
import {
  type CardReview,
  type CardSchedule,
  DEFAULT_DECK_OPTIONS,
  DEFAULT_FSRS_PARAMS,
  type NativeCard,
  type NativeDeck,
  type NativeNote,
  type NativeNotetype,
  type VocabFields,
  replayReviews,
  scheduleFromInterval,
  wordKey,
} from "@app/core";
import { cleanField, firstAlternative, firstSentence, sentenceUnits } from "../clean.js";
import { type DetectFn, type NoteSample, rankCandidates, selectCandidates } from "../detect.js";
import type { TermKey } from "../snapshot.js";
import type { AnkiCollection, AnkiNotetypeData, AnkiReviewData } from "./read.js";

const DAY_MS = 86_400_000;
/** Notes per event, so one import never becomes a single huge event. */
const CHUNK_NOTES = 300;
const SAMPLE = 30;

/** A deck of a collection with what an import of it would bring. */
export interface PackageDeck {
  name: string;
  notes: number;
  cards: number;
  reviews: number;
}

/** Decks with cards, with their counts (a deck's own cards, not its subdecks'). */
export function packageDecks(col: AnkiCollection): PackageDeck[] {
  const names = new Map(col.decks.map((d) => [d.id, d.name]));
  const reviewed = new Map<number, number>();
  for (const r of col.reviews) reviewed.set(r.cardId, (reviewed.get(r.cardId) ?? 0) + 1);
  const out = new Map<string, { notes: Set<number>; cards: number; reviews: number }>();
  for (const c of col.cards) {
    const name = names.get(c.deckId) ?? "Default";
    const d = out.get(name) ?? { notes: new Set(), cards: 0, reviews: 0 };
    d.notes.add(c.noteId);
    d.cards++;
    d.reviews += reviewed.get(c.id) ?? 0;
    out.set(name, d);
  }
  return [...out]
    .map(([name, d]) => ({ name, notes: d.notes.size, cards: d.cards, reviews: d.reviews }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface NativeImportDeps {
  lang: string;
  origin: "apkg" | "anki";
  /** Language identification (the language server); without it, field names decide. */
  detect?: DetectFn;
  /** Headwords to learner-model keys (the language server); without it, `wordKey`. */
  analyzeTerms?: (terms: string[]) => Promise<TermKey[]>;
  /** Store one media file; returns its blob id, or null when it cannot be stored. */
  putMedia?: (name: string, bytes: Uint8Array) => Promise<string | null>;
  onProgress?: (message: string) => void;
  /** Answer time used for cards whose history is missing. */
  now?: number;
}

/** The events of one import (each a NativeNotesAdded) and what it brought. */
export interface NativeImport {
  events: {
    type: "NativeNotesAdded";
    lang: string;
    origin: "apkg" | "anki";
    notetypes?: NativeNotetype[];
    decks?: NativeDeck[];
    notes: NativeNote[];
    cards: NativeCard[];
    reviews?: CardReview[];
    media?: Record<string, string>;
  }[];
  notes: number;
  cards: number;
  reviews: number;
  /** Notes recognised as vocabulary (they feed the learner model). */
  vocabNotes: number;
  media: number;
  /** Media files that could not be stored (unknown type or too large). */
  skippedMedia: number;
  /** FSRS-6 parameters Anki had trained for these decks, if any. */
  fsrsParams?: number[];
}

const KIND = ["learn", "review", "relearn", "filtered"] as const;

/** A review-log entry as a Vuurtoren review. Manual changes carry rating 0. */
export function toCardReview(r: AnkiReviewData): CardReview {
  const answered = r.ease >= 1 && r.ease <= 4 && r.type <= 3;
  return {
    cardId: r.cardId,
    at: r.at,
    rating: answered ? (r.ease as 1 | 2 | 3 | 4) : 0,
    kind: answered ? KIND[r.type]! : "manual",
    durationMs: Math.max(0, r.timeMs),
  };
}

const WORD_NAME = /^(word|woord|front|voorkant|dutch|nederlands|term|lemma|headword|vocab)/i;
const GLOSS_NAME = /^(betekenis|meaning|translation|vertaling|english|engels|gloss|back)$/i;
const SENTENCE_NAME = /(sentence|zin|example|voorbeeld)/i;

/** Vocabulary fields from field names only (when language identification is unavailable). */
function vocabByName(t: AnkiNotetypeData): VocabFields | undefined {
  const word = t.fields.find((f) => WORD_NAME.test(f));
  if (!word) return undefined;
  const gloss = t.fields.find((f) => GLOSS_NAME.test(f));
  const sentence = t.fields.find((f) => SENTENCE_NAME.test(f) && !/(en|eng|english)$/i.test(f));
  return { word, ...(gloss ? { gloss } : {}), ...(sentence ? { sentence } : {}) };
}

/** Which note types of the chosen notes hold vocabulary, and in which fields. */
async function detectVocab(
  col: AnkiCollection,
  notes: AnkiCollection["notes"],
  deckOfNote: Map<number, string>,
  deps: NativeImportDeps,
): Promise<Map<number, VocabFields>> {
  const types = new Map(col.notetypes.map((t) => [t.id, t]));
  const out = new Map<number, VocabFields>();
  const groups = new Map<string, AnkiCollection["notes"]>();
  for (const n of notes) {
    const k = `${deckOfNote.get(n.id) ?? ""}\u0000${n.notetypeId}`;
    groups.set(k, [...(groups.get(k) ?? []), n]);
  }
  if (deps.detect) {
    const samples: NoteSample[] = [];
    for (const [k, group] of groups) {
      const t = types.get(group[0]!.notetypeId);
      if (!t) continue;
      for (const n of group.slice(0, SAMPLE)) {
        samples.push({
          deck: k.split("\u0000")[0]!,
          deckNoteCount: group.length,
          modelName: String(t.id),
          fields: Object.fromEntries(t.fields.map((f, i) => [f, n.fields[i] ?? ""])),
        });
      }
    }
    try {
      const ranked = selectCandidates(await rankCandidates(samples, deps.detect, deps.lang));
      for (const c of ranked) {
        const id = Number(c.modelName);
        if (out.has(id)) continue;
        out.set(id, {
          word: c.wordField,
          ...(c.sentenceField ? { sentence: c.sentenceField } : {}),
          ...(c.glossField ? { gloss: c.glossField } : {}),
          ...(c.sentenceTranslationField
            ? { sentenceTranslation: c.sentenceTranslationField }
            : {}),
        });
      }
      return out;
    } catch {
      deps.onProgress?.("Language detection is unavailable; using field names");
    }
  }
  for (const t of col.notetypes) {
    const v = vocabByName(t);
    if (v) out.set(t.id, v);
  }
  return out;
}

/** File names a field refers to: images and sounds. */
export function mediaRefs(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<img[^>]+src=["']?([^"'>]+)["']?/gi)) out.push(m[1]!);
  for (const m of html.matchAll(/\[sound:([^\]]+)\]/g)) out.push(m[1]!.trim());
  return out.filter((n) => !/^(https?:|data:)/i.test(n));
}

/**
 * Build the import of the chosen decks (exact names; pick subdecks by naming them too).
 * Media files are stored through `putMedia` as they are met.
 */
export async function buildNativeImport(
  col: AnkiCollection,
  deckNames: readonly string[],
  deps: NativeImportDeps,
): Promise<NativeImport> {
  const wanted = new Set(deckNames);
  const decks = col.decks.filter((d) => wanted.has(d.name));
  const deckById = new Map(col.decks.map((d) => [d.id, d]));
  const cards = col.cards.filter((c) => wanted.has(deckById.get(c.deckId)?.name ?? "Default"));
  const noteIds = new Set(cards.map((c) => c.noteId));
  const notes = col.notes.filter((n) => noteIds.has(n.id));
  const deckOfNote = new Map<number, string>();
  for (const c of cards) {
    if (!deckOfNote.has(c.noteId)) deckOfNote.set(c.noteId, deckById.get(c.deckId)?.name ?? "");
  }
  const usedTypes = new Set(notes.map((n) => n.notetypeId));
  const typeById = new Map(col.notetypes.map((t) => [t.id, t]));

  deps.onProgress?.("Recognising vocabulary fields");
  const vocab = await detectVocab(col, notes, deckOfNote, deps);

  // Learner-model keys of the headwords, in one batch.
  const vocabNotes = notes.filter((n) => vocab.has(n.notetypeId));
  const fieldOf = (n: (typeof notes)[number], name: string | undefined): string => {
    if (!name) return "";
    const t = typeById.get(n.notetypeId);
    const i = t ? t.fields.indexOf(name) : -1;
    return i >= 0 ? (n.fields[i] ?? "") : "";
  };
  const heads = vocabNotes.map((n) => {
    const c = cleanField(fieldOf(n, vocab.get(n.notetypeId)!.word));
    return c.length > 200 ? "" : c;
  });
  deps.onProgress?.(`Reading ${heads.length} headwords`);
  let terms: TermKey[] | null = null;
  if (deps.analyzeTerms && heads.length) {
    try {
      terms = [];
      for (let i = 0; i < heads.length; i += 500) {
        terms.push(...(await deps.analyzeTerms(heads.slice(i, i + 500))));
      }
    } catch {
      terms = null;
    }
  }
  const termOf = new Map<number, TermKey>();
  vocabNotes.forEach((n, i) => {
    const head = heads[i] ?? "";
    const t = terms?.[i] ?? {
      key: head ? wordKey(deps.lang, firstAlternative(head)) : "",
      aliases: [],
      article: null,
    };
    termOf.set(n.id, t);
  });

  const nativeNotes: NativeNote[] = notes.map((n) => {
    const note: NativeNote = {
      id: n.id,
      notetypeId: `anki:${n.notetypeId}`,
      fields: n.fields,
      tags: n.tags,
    };
    const v = vocab.get(n.notetypeId);
    const term = termOf.get(n.id);
    if (v && term?.key) {
      note.key = term.key;
      if (term.aliases.length) note.aliases = term.aliases.filter((a) => a && a !== term.key);
      if (term.article) note.article = term.article;
      const gloss = firstAlternative(cleanField(fieldOf(n, v.gloss)));
      if (gloss) note.gloss = gloss;
      const sRaw = fieldOf(n, v.sentence);
      const sentence = firstSentence(sRaw);
      if (sentence) {
        note.sentence = sentence;
        const tRaw = fieldOf(n, v.sentenceTranslation);
        if (tRaw && sentenceUnits(sRaw).length === sentenceUnits(tRaw).length) {
          note.sentenceTranslation = firstSentence(tRaw);
        }
      }
    }
    return note;
  });

  // Anki's own trained FSRS-6 parameters, when a chosen deck's preset has them.
  const fsrsParams = decks.find((d) => d.fsrsParams)?.fsrsParams;
  const params = fsrsParams ?? DEFAULT_FSRS_PARAMS;
  const byCard = new Map<number, CardReview[]>();
  for (const r of col.reviews) {
    const list = byCard.get(r.cardId);
    const rev = toCardReview(r);
    if (list) list.push(rev);
    else byCard.set(r.cardId, [rev]);
  }
  deps.onProgress?.("Replaying the review history");
  const now = deps.now ?? Date.now();
  const nativeCards: NativeCard[] = cards.map((c, i) => {
    const deck = deckById.get(c.deckId);
    const card: NativeCard = {
      id: c.id,
      noteId: c.noteId,
      ord: c.ord,
      deck: deck?.name ?? "Default",
      position: c.newPosition ?? i,
    };
    if (c.queue === -1) card.suspended = true;
    if (c.type === 0) return card;
    const history = byCard.get(c.id) ?? [];
    let s: CardSchedule | undefined = replayReviews(history, {
      options: deck?.options ?? DEFAULT_DECK_OPTIONS,
      params,
    });
    const due = c.dueMs ?? (s ? s.due : now);
    if (!s) s = scheduleFromInterval(c.intervalDays, due, due - c.intervalDays * DAY_MS);
    else if (c.type === 2 && c.dueMs !== undefined) {
      // A review card keeps the due date Anki gave it; its memory comes from the replay.
      s = { ...s, state: 2, due: c.dueMs, scheduledDays: Math.max(1, c.intervalDays) };
    }
    card.schedule = s;
    return card;
  });
  const cardIds = new Set(cards.map((c) => c.id));
  const reviews = col.reviews.filter((r) => cardIds.has(r.cardId)).map(toCardReview);

  // Media the chosen notes use.
  const needed = new Set(nativeNotes.flatMap((n) => n.fields.flatMap(mediaRefs)));
  for (const t of usedTypes) {
    for (const tp of typeById.get(t)?.templates ?? []) {
      for (const ref of [...mediaRefs(tp.front), ...mediaRefs(tp.back)]) needed.add(ref);
    }
  }
  const media: Record<string, string> = {};
  let skippedMedia = 0;
  if (deps.putMedia) {
    const files = col.media.filter((m) => needed.has(m.name));
    for (const [i, m] of files.entries()) {
      if (i % 50 === 0) deps.onProgress?.(`Storing media ${i + 1} of ${files.length}`);
      const id = await deps.putMedia(m.name, await m.bytes()).catch(() => null);
      if (id) media[m.name] = id;
      else skippedMedia++;
    }
  }

  const notetypes: NativeNotetype[] = [...usedTypes].flatMap((id) => {
    const t = typeById.get(id);
    if (!t) return [];
    const v = vocab.get(id);
    return [
      {
        id: `anki:${t.id}`,
        name: t.name,
        kind: t.kind,
        fields: t.fields,
        templates: t.templates,
        css: t.css,
        ...(v ? { vocab: v } : {}),
      },
    ];
  });
  const nativeDecks: NativeDeck[] = decks.map((d) => ({ name: d.name, options: d.options }));
  const cardsOfNote = new Map<number, NativeCard[]>();
  for (const c of nativeCards) cardsOfNote.set(c.noteId, [...(cardsOfNote.get(c.noteId) ?? []), c]);
  const reviewsOfCard = new Map<number, CardReview[]>();
  for (const r of reviews) reviewsOfCard.set(r.cardId, [...(reviewsOfCard.get(r.cardId) ?? []), r]);

  const events: NativeImport["events"] = [];
  for (let i = 0; i < nativeNotes.length || i === 0; i += CHUNK_NOTES) {
    const chunk = nativeNotes.slice(i, i + CHUNK_NOTES);
    const chunkCards = chunk.flatMap((n) => cardsOfNote.get(n.id) ?? []);
    events.push({
      type: "NativeNotesAdded",
      lang: deps.lang,
      origin: deps.origin,
      ...(i === 0 ? { notetypes, decks: nativeDecks, media } : {}),
      notes: chunk,
      cards: chunkCards,
      reviews: chunkCards.flatMap((c) => reviewsOfCard.get(c.id) ?? []),
    });
    if (nativeNotes.length === 0) break;
  }
  return {
    events,
    notes: nativeNotes.length,
    cards: nativeCards.length,
    reviews: reviews.length,
    vocabNotes: nativeNotes.filter((n) => n.key).length,
    media: Object.keys(media).length,
    skippedMedia,
    ...(fsrsParams ? { fsrsParams } : {}),
  };
}
