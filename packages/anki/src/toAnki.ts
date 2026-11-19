/**
 * Move to Anki: the one-time move from native mode back to Anki, through AnkiConnect. Words
 * become notes of Kenning's note type in their own deck; cards Kenning has reviewed get their
 * next due date with that gap as their interval. As an option (experimental), the review
 * history goes in too, with real answer times, and each card's interval, reviews and lapses.
 * Notes Anki already holds (cards that came from Anki keep their ids) are not added again.
 */
import {
  type CardReview,
  type CardSchedule,
  DEFAULT_DECK_OPTIONS,
  DEFAULT_FSRS_PARAMS,
  type DeckOptions,
  type NativeCard,
  type NativeNote,
  type NativeNotetype,
} from "@app/core";
import { revlogRows } from "./apkg/write.js";
import type { AnkiConnectClient } from "./client.js";
import { NOTE_TYPE, ensureNoteType } from "./note.js";

const DAY_MS = 86_400_000;
const BATCH = 100;
/** Tag on every note the move adds. */
export const TAG_MOVED = "kenning::moved";

export interface ToAnkiInput {
  notetypes: NativeNotetype[];
  decks: { name: string; options: DeckOptions }[];
  notes: NativeNote[];
  cards: NativeCard[];
  reviews: CardReview[];
  params?: readonly number[];
  now: number;
  /** Also write the review history and exact intervals (experimental). */
  withHistory: boolean;
}

export interface ToAnkiResult {
  /** Notes added to Anki. */
  added: number;
  /** Notes Anki already had. */
  existing: number;
  /** Notes of other note types without a word, left out (the .apkg export carries them). */
  skipped: number;
  /** Cards given a due date and interval. */
  scheduled: number;
  /** Review-history entries written (with history only). */
  reviews: number;
  /** Decks holding the moved words, for the language profile. */
  decks: string[];
}

const strip = (s: string) =>
  s
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();

/** Start of the study day (4:00 local time) that `ms` falls in. */
function dayStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(4, 0, 0, 0);
  if (d.getTime() > ms) d.setDate(d.getDate() - 1);
  return d.getTime();
}

/** The fields of a Kenning Word note for a native note, or null when it holds no word. */
export function wordFields(
  note: NativeNote,
  type: NativeNotetype | undefined,
): Record<string, string> | null {
  if (!type) return null;
  const field = (name: string | undefined) =>
    name === undefined ? "" : (note.fields[type.fields.indexOf(name)] ?? "");
  if (type.id === "kenning-word") {
    return Object.fromEntries(type.fields.map((f, i) => [f, note.fields[i] ?? ""]));
  }
  const v = type.vocab;
  if (!v || !strip(field(v.word))) return null;
  return {
    Word: field(v.word),
    Gloss: field(v.gloss) || (note.gloss ?? ""),
    Sentence: field(v.sentence),
    SentenceTranslation: field(v.sentenceTranslation),
    Source: "",
  };
}

/** The card a moved note's single Anki card stands for: its most advanced native card. */
function leadCard(cards: NativeCard[]): NativeCard | undefined {
  return [...cards].sort(
    (a, b) => (b.schedule?.stability ?? -1) - (a.schedule?.stability ?? -1) || a.ord - b.ord,
  )[0];
}

export async function moveToAnki(
  anki: AnkiConnectClient,
  input: ToAnkiInput,
  onProgress?: (message: string) => void,
): Promise<ToAnkiResult> {
  const { now } = input;
  const types = new Map(input.notetypes.map((t) => [t.id, t]));
  const options = new Map(input.decks.map((d) => [d.name, d.options]));
  const params = input.params?.length === 21 ? input.params : DEFAULT_FSRS_PARAMS;
  const cardsOf = new Map<number, NativeCard[]>();
  for (const c of input.cards) cardsOf.set(c.noteId, [...(cardsOf.get(c.noteId) ?? []), c]);

  onProgress?.("Checking which words Anki has");
  const known = new Set(
    (await anki.notesInfo(input.notes.map((n) => n.id)))
      .filter((n) => typeof n.noteId === "number")
      .map((n) => n.noteId),
  );

  // Native card → Anki card: the same id for notes Anki has, the new note's card otherwise.
  const pairs: { native: NativeCard; anki: number; fresh: boolean }[] = [];
  const toAdd: { note: NativeNote; deck: string; fields: Record<string, string> }[] = [];
  let skipped = 0;
  for (const note of input.notes) {
    const own = cardsOf.get(note.id) ?? [];
    if (own.length === 0) continue;
    if (known.has(note.id)) {
      for (const c of own) pairs.push({ native: c, anki: c.id, fresh: false });
      continue;
    }
    const fields = wordFields(note, types.get(note.notetypeId));
    if (!fields) {
      skipped++;
      continue;
    }
    toAdd.push({ note, deck: leadCard(own)!.deck, fields });
  }

  const decks = new Set<string>();
  let added = 0;
  if (toAdd.length) {
    onProgress?.(`Adding ${toAdd.length} words to Anki`);
    await ensureNoteType(anki);
    for (const deck of new Set(toAdd.map((a) => a.deck))) {
      await anki.invoke("createDeck", { deck });
    }
    const ids = await anki.multi<number>(
      toAdd.map((a) => ({
        action: "addNote",
        params: {
          note: {
            deckName: a.deck,
            modelName: NOTE_TYPE,
            fields: a.fields,
            tags: [...new Set([...a.note.tags, "kenning", TAG_MOVED])],
            options: { allowDuplicate: false, duplicateScope: "deck" },
          },
        },
      })),
    );
    const newIds: number[] = [];
    const lead = new Map<number, NativeCard>();
    toAdd.forEach((a, i) => {
      const reply = ids[i];
      if (!reply?.ok || typeof reply.result !== "number") return;
      const id = reply.result;
      added++;
      decks.add(a.deck);
      newIds.push(id);
      lead.set(id, leadCard(cardsOf.get(a.note.id) ?? [])!);
    });
    for (const info of await anki.notesInfo(newIds)) {
      const card = info.cards?.[0];
      const native = lead.get(info.noteId);
      if (card !== undefined && native) pairs.push({ native, anki: card, fresh: true });
    }
  }
  for (const p of pairs) if (!p.fresh) decks.add(p.native.deck);

  // Schedules: due on the same study day, with that gap as the interval.
  const today = dayStart(now);
  const reviewed = pairs.filter((p) => p.native.schedule?.state === 2);
  const byDays = new Map<number, number[]>();
  for (const p of reviewed) {
    const s = p.native.schedule as CardSchedule;
    const days = Math.max(1, Math.round((dayStart(s.due) - today) / DAY_MS));
    byDays.set(days, [...(byDays.get(days) ?? []), p.anki]);
  }
  if (byDays.size) onProgress?.("Setting due dates");
  await anki.multi(
    [...byDays].map(([days, cards]) => ({
      action: "setDueDate",
      params: { cards, days: `${days}!` },
    })),
  );
  const suspended = pairs.filter((p) => p.native.suspended).map((p) => p.anki);
  if (suspended.length) await anki.invoke("suspend", { cards: suspended });

  let reviews = 0;
  if (input.withHistory) {
    onProgress?.("Writing the review history");
    // Exact interval, reviews and lapses (the due date is already set).
    await anki.multi(
      reviewed.map((p) => {
        const s = p.native.schedule as CardSchedule;
        return {
          action: "setSpecificValueOfCard",
          params: {
            card: p.anki,
            keys: ["ivl", "reps", "lapses"],
            newValues: [Math.max(1, Math.round(s.scheduledDays)), s.reps, s.lapses],
            warning_check: true,
          },
        };
      }),
    );
    // History already in Anki (cards that came from Anki) is not written twice.
    const existing = new Set<number>();
    const old = pairs.filter((p) => !p.fresh).map((p) => p.anki);
    for (let i = 0; i < old.length; i += BATCH) {
      const got = await anki.invoke<Record<string, { id: number }[]>>("getReviewsOfCards", {
        cards: old.slice(i, i + BATCH).map(String),
      });
      for (const list of Object.values(got ?? {})) for (const r of list) existing.add(r.id);
    }
    const byCard = new Map<number, CardReview[]>();
    for (const r of input.reviews) byCard.set(r.cardId, [...(byCard.get(r.cardId) ?? []), r]);
    const taken = new Set(existing);
    const rows: (number | string)[][] = [];
    for (const p of pairs) {
      const list = byCard.get(p.native.id) ?? [];
      const opts = options.get(p.native.deck) ?? DEFAULT_DECK_OPTIONS;
      for (const row of revlogRows(list, opts, params)) {
        let id = Math.round(row.at);
        if (existing.has(id)) continue;
        while (taken.has(id)) id++;
        taken.add(id);
        rows.push([
          id,
          p.anki,
          -1,
          row.ease,
          row.ivl,
          row.lastIvl,
          row.type === 0 ? 0 : 2500,
          row.time,
          row.type,
        ]);
      }
    }
    for (let i = 0; i < rows.length; i += 1000) {
      await anki.invoke("insertReviews", { reviews: rows.slice(i, i + 1000) });
    }
    reviews = rows.length;
  }

  return {
    added,
    existing: known.size,
    skipped,
    scheduled: reviewed.length,
    reviews,
    decks: [...decks].sort(),
  };
}
