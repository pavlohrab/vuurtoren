/**
 * Build the learner-model snapshot from Anki: detect every target-language deck, read notes,
 * cards, review log and (if FSRS is on) memory state, map headwords to keys with the NLP
 * analyzer, and merge per key. Read-only. Shared by the web app and tools/anki-report.
 */
import { type WordKnowledge, type WordState, classifyCard, mergeKnowledge } from "@app/core";
import { cleanField } from "./clean.js";
import {
  type AnkiConnectClient,
  type CardInfo,
  type NoteInfo,
  ankiEscape,
  exactDeckQuery,
} from "./client.js";
import {
  type Candidate,
  type DetectFn,
  type NoteSample,
  rankCandidates,
  selectCandidates,
} from "./detect.js";
import { type CardExtras, noteMemory } from "./memory.js";

/** Subset of server/nlp TermAnalysis needed here. */
export interface TermKey {
  key: string;
  aliases: string[];
  article: string | null;
}

export interface SnapshotDeps {
  anki: AnkiConnectClient;
  lang: string;
  detect: DetectFn;
  analyzeTerms: (terms: string[]) => Promise<TermKey[]>;
  /** Minimum target-language share of a word field (default 0.5). */
  minShare?: number;
  /** Notes sampled per deck for detection (default 30). */
  samplePerDeck?: number;
  /** Restrict to these deck names. */
  decks?: string[];
  random?: () => number;
  onProgress?: (message: string) => void;
  now?: number;
}

/** Structurally compatible with @app/db AnkiWordEntry. */
export interface SnapshotEntry {
  key: string;
  state: WordState;
  pKnown: number;
  noteIds: number[];
  decks: string[];
  gloss?: string;
  article?: string;
}

/** Per-note detail, useful for reports and checks. */
export interface SnapshotNote {
  source: Candidate;
  note: NoteInfo;
  raw: string;
  cleaned: string;
  term: TermKey;
  studied: boolean;
  knowledge: WordKnowledge;
}

export interface Snapshot {
  lang: string;
  candidates: Candidate[];
  sources: Candidate[];
  entries: SnapshotEntry[];
  notes: SnapshotNote[];
  cards: number;
  reviewedCards: number;
  fsrsCards: number;
}

const MIN_DECK_NOTES = 10;

function sampleOf<T>(xs: T[], n: number, random: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a.slice(0, n);
}

const fieldValues = (n: NoteInfo) =>
  Object.fromEntries(Object.entries(n.fields).map(([k, v]) => [k, v.value]));

/** Detect which deck/note-type pairs hold target-language vocabulary. */
export async function detectSources(
  deps: SnapshotDeps,
): Promise<{ candidates: Candidate[]; selected: Candidate[] }> {
  const random = deps.random ?? Math.random;
  const samples: NoteSample[] = [];
  const deckNames = (await deps.anki.deckNames()).filter(
    (d) => !deps.decks || deps.decks.includes(d),
  );
  for (const d of deckNames) {
    const ids = await deps.anki.findNotes(exactDeckQuery(d));
    if (ids.length < MIN_DECK_NOTES && !deps.decks) continue;
    for (const n of await deps.anki.notesInfo(sampleOf(ids, deps.samplePerDeck ?? 30, random))) {
      samples.push({
        deck: d,
        deckNoteCount: ids.length,
        modelName: n.modelName,
        fields: fieldValues(n),
      });
    }
  }
  deps.onProgress?.(`Sampled ${samples.length} notes from ${deckNames.length} decks`);
  const candidates = await rankCandidates(samples, deps.detect, deps.lang);
  return { candidates, selected: selectCandidates(candidates, deps.minShare ?? 0.5) };
}

/** Build the full snapshot (optionally for already-chosen sources). */
export async function buildSnapshot(deps: SnapshotDeps, chosen?: Candidate[]): Promise<Snapshot> {
  const now = deps.now ?? Date.now();
  const { candidates, selected } = chosen
    ? { candidates: chosen, selected: chosen }
    : await detectSources(deps);
  if (!selected.length) throw new Error(`No ${deps.lang} vocabulary decks found in Anki.`);
  deps.onProgress?.(
    `Reading ${selected.length} deck(s): ${selected.map((s) => s.deck).join(", ")}`,
  );

  const loaded: { source: Candidate; notes: NoteInfo[]; cards: CardInfo[] }[] = [];
  for (const source of selected) {
    const ids = await deps.anki.findNotes(
      `${exactDeckQuery(source.deck)} "note:${ankiEscape(source.modelName)}"`,
    );
    const notes = await deps.anki.notesInfo(ids);
    const cards = await deps.anki.cardsInfo(notes.flatMap((n) => n.cards));
    loaded.push({ source, notes, cards });
  }
  const allCards = loaded.flatMap((l) => l.cards);
  const reviewed = allCards.filter((c) => c.type !== 0).map((c) => c.cardId);

  deps.onProgress?.(`Reading review history of ${reviewed.length} cards`);
  const extras: CardExtras = { lastReviewMs: await deps.anki.lastReviews(reviewed) };
  let fsrsCards = 0;
  if (reviewed.length && (await deps.anki.hasV1())) {
    extras.fsrs = await deps.anki.fsrsMemory(reviewed);
    fsrsCards = [...extras.fsrs.values()].filter(Boolean).length;
  }

  const pending = loaded.flatMap(({ source, notes, cards }) => {
    const byNote = new Map<number, CardInfo[]>();
    for (const c of cards) byNote.set(c.note, [...(byNote.get(c.note) ?? []), c]);
    return notes.map((note) => {
      const raw = note.fields[source.wordField]?.value ?? "";
      const memory = noteMemory(byNote.get(note.noteId) ?? [], extras);
      return { source, note, raw, cleaned: cleanField(raw), memory };
    });
  });
  deps.onProgress?.(`Analysing ${pending.length} headwords`);
  const terms = await deps.analyzeTerms(pending.map((p) => p.cleaned));

  const notes: SnapshotNote[] = pending.map((p, i) => ({
    source: p.source,
    note: p.note,
    raw: p.raw,
    cleaned: p.cleaned,
    term: terms[i]!,
    studied: !p.memory.isNew,
    knowledge: classifyCard(p.memory, now),
  }));

  const byKey = new Map<string, SnapshotEntry>();
  const knowledgeOf = new Map<string, WordKnowledge>();
  for (const n of notes) {
    const gloss = n.source.glossField
      ? cleanField(n.note.fields[n.source.glossField]?.value ?? "")
      : "";
    for (const key of [n.term.key, ...n.term.aliases]) {
      if (!key) continue;
      const prev = byKey.get(key);
      const knowledge = mergeKnowledge(knowledgeOf.get(key), n.knowledge);
      knowledgeOf.set(key, knowledge);
      const entry: SnapshotEntry = {
        key,
        state: knowledge.state,
        pKnown: knowledge.pKnown,
        noteIds: [...new Set([...(prev?.noteIds ?? []), n.note.noteId])],
        decks: [...new Set([...(prev?.decks ?? []), n.source.deck])],
      };
      const g = prev?.gloss ?? (gloss || undefined);
      if (g) entry.gloss = g;
      const article = prev?.article ?? n.term.article ?? undefined;
      if (article) entry.article = article;
      byKey.set(key, entry);
    }
  }
  const entries = [...byKey.values()];
  deps.onProgress?.(`Snapshot: ${entries.length} words`);
  return {
    lang: deps.lang,
    candidates,
    sources: selected,
    entries,
    notes,
    cards: allCards.length,
    reviewedCards: reviewed.length,
    fsrsCards,
  };
}
