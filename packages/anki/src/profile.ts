/**
 * The language profile meets Anki (ADR 0010): which deck/note-type pairs a snapshot reads, and
 * the one command that adds a word to Anki for every caller (reader, Words from this text,
 * Converse, courses, MCP). Platform-neutral: needs only an AnkiConnect client and a callback that
 * records the event, so the web app and the MCP server share it.
 */
import {
  type AddContext,
  type LanguageProfile,
  type ProfileSource,
  destinationDecks,
  noteTags,
  resolveDeck,
  wordKey,
} from "@app/core";
import type { AnkiConnectClient } from "./client.js";
import { type Candidate, selectCandidates } from "./detect.js";
import { addNoteAsKnown } from "./actions.js";
import { NOTE_TYPE, addWordNote } from "./note.js";
import { type SnapshotDeps, detectSources } from "./snapshot.js";

/** A Candidate that needs no detection (fields are known). */
function knownCandidate(
  deck: string,
  modelName: string,
  f: { wordField: string; sentenceField?: string | null; glossField?: string | null },
  sentenceTranslationField: string | null = null,
): Candidate {
  return {
    deck,
    modelName,
    noteCount: 0,
    wordField: f.wordField,
    sentenceField: f.sentenceField ?? null,
    glossField: f.glossField ?? null,
    sentenceTranslationField,
    targetShare: 1,
    confidence: 1,
    score: 1,
    fields: [],
    examples: [],
  };
}

/** Kenning's own note type in a destination deck. */
export const kenningCandidate = (deck: string): Candidate =>
  knownCandidate(
    deck,
    NOTE_TYPE,
    { wordField: "Word", sentenceField: "Sentence", glossField: "Gloss" },
    "SentenceTranslation",
  );

/** The profile entry for a detected candidate the user confirmed. */
export function sourceFromCandidate(c: Candidate): ProfileSource {
  return {
    deck: c.deck,
    modelName: c.modelName,
    wordField: c.wordField,
    ...(c.sentenceField ? { sentenceField: c.sentenceField } : {}),
    ...(c.glossField ? { glossField: c.glossField } : {}),
  };
}

/** Apply the user's field choices to a detected candidate. */
function withOverrides(c: Candidate, s: ProfileSource): Candidate {
  return {
    ...c,
    ...(s.wordField ? { wordField: s.wordField } : {}),
    ...(s.sentenceField ? { sentenceField: s.sentenceField } : {}),
    ...(s.glossField ? { glossField: s.glossField } : {}),
  };
}

/**
 * The sources a snapshot reads for a profile: every confirmed source, every existing destination
 * deck (Kenning's note type) and every extra deck (decks mapped to course units). Detection only
 * fills in what the profile leaves open (note type and fields of a source confirmed by deck name,
 * and course decks); a confirmed deck is read even when detection would not have picked it.
 * Decks that do not exist in Anki (yet) are skipped.
 */
export async function profileSources(
  deps: Omit<SnapshotDeps, "decks" | "alwaysInclude">,
  profile: LanguageProfile,
  extraDecks: string[] = [],
): Promise<Candidate[]> {
  const existing = new Set(await deps.anki.deckNames());
  const out = new Map<string, Candidate>();
  const add = (c: Candidate) => {
    const k = `${c.deck}\u0000${c.modelName}`;
    if (!out.has(k)) out.set(k, c);
  };
  for (const deck of destinationDecks(profile)) if (existing.has(deck)) add(kenningCandidate(deck));

  const toDetect: ProfileSource[] = [];
  for (const s of profile.sources) {
    if (!existing.has(s.deck)) continue;
    if (s.modelName && s.wordField)
      add(knownCandidate(s.deck, s.modelName, s as { wordField: string }));
    else toDetect.push(s);
  }
  const covered = new Set([...out.values()].map((c) => c.deck));
  for (const deck of new Set(extraDecks)) {
    if (existing.has(deck) && !covered.has(deck) && !toDetect.some((s) => s.deck === deck))
      toDetect.push({ deck });
  }
  if (toDetect.length === 0) return [...out.values()];

  const decks = [...new Set(toDetect.map((s) => s.deck))];
  const { candidates } = await detectSources({ ...deps, decks, alwaysInclude: decks });
  const picked = new Set(selectCandidates(candidates, deps.minShare ?? 0.5));
  for (const s of toDetect) {
    const own = candidates
      .filter((c) => c.deck === s.deck && (!s.modelName || c.modelName === s.modelName))
      .sort((a, b) => b.score - a.score);
    // The user confirmed (or mapped) this deck: when detection is unsure, trust the best guess.
    const chosen = own.filter((c) => picked.has(c));
    for (const c of chosen.length ? chosen : own.slice(0, 1)) add(withOverrides(c, s));
  }
  return [...out.values()];
}

/** The event recorded after a note was added (structurally an @app/db AppEvent). */
export interface NoteAddedEvent {
  type: "NoteAddedToAnki";
  lang: string;
  key: string;
  noteId: number;
  deck: string;
}

export interface AddWordRequest {
  profile: LanguageProfile;
  /** Where the word comes from; `context.deck` is an explicit picker choice. */
  context: AddContext;
  /** Headword as it should appear on the card, e.g. "de fiets". */
  word: string;
  /** Learner-model key when the caller already matched one (reader tokens). */
  key?: string;
  gloss?: string;
  /** May contain `<b>…</b>` from highlightSentence; other markup is neutralised. */
  sentence?: string;
  sentenceTranslation?: string;
  /** Shown on the card's back, e.g. the text title. */
  source?: string;
  extraTags?: string[];
  /** Mark known (ADR 0007): also give the new card a mature interval. */
  asKnown?: boolean;
}

export interface AddWordResult {
  noteId: number;
  deck: string;
  key: string;
  /** Cards marked known (only with `asKnown`). */
  cardIds: number[];
}

/**
 * Add a word to Anki: resolve the deck from the profile, create the note type and the deck when
 * missing, add the note (an identical one in that deck is reused) and record `NoteAddedToAnki`
 * with the one key rule (`wordKey`). Only call from an explicit user action (ADR 0007).
 */
export async function addWordToAnki(
  anki: AnkiConnectClient,
  record: (e: NoteAddedEvent) => Promise<unknown>,
  req: AddWordRequest,
): Promise<AddWordResult> {
  const word = req.word.trim();
  if (!word) throw new Error("The word is empty");
  const { profile } = req;
  const deck = resolveDeck(profile, req.context);
  const note = {
    deck,
    word,
    tags: noteTags(profile, req.context.source, req.extraTags),
    ...(req.gloss?.trim() ? { gloss: req.gloss.trim() } : {}),
    ...(req.sentence?.trim() ? { sentence: req.sentence.trim() } : {}),
    ...(req.sentenceTranslation ? { sentenceTranslation: req.sentenceTranslation } : {}),
    ...(req.source ? { source: req.source } : {}),
  };
  let noteId: number;
  let cardIds: number[] = [];
  if (req.asKnown) ({ noteId, cardIds } = await addNoteAsKnown(anki, note));
  else noteId = await addWordNote(anki, note);
  const key = wordKey(profile.lang, word, req.key);
  await record({ type: "NoteAddedToAnki", lang: profile.lang, key, noteId, deck });
  return { noteId, deck, key, cardIds };
}
