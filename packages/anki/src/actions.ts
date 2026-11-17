/**
 * Explicit write actions on existing Anki cards (ADR 0007): learn next, mark known, and the
 * live card status the inspector needs to decide which buttons to offer.
 * Every function acts only on the ids it is given; the app never calls them in the background.
 */
import { AnkiConnectError, type AnkiConnectClient, type CardInfo } from "./client.js";
import { type NewWordNote, addWordNote } from "./note.js";

/** Tag put on notes whose cards were moved to the front of the new queue. */
export const TAG_READING = "kenning::reading";
/** Tag put on notes whose cards were marked known from the app. */
export const TAG_KNOWN = "kenning::known";
/** Anki's day syntax: "21-35!" sets the interval (not just the due date) to 21–35 days. */
export const KNOWN_DUE_DATE = "21-35!";
/** Interval from which a card counts as mature. */
export const MATURE_DAYS = 21;

export type CardType = "new" | "learning" | "review" | "relearning";

export interface CardState {
  cardId: number;
  type: CardType;
  suspended: boolean;
  buried: boolean;
  /** Human text for review cards, e.g. "due in 6 days". Absent when unknown. */
  dueText?: string;
  /** Review interval in days (0 for new and learning cards). */
  intervalDays: number;
}

export interface NoteCardStatus {
  noteId: number;
  /** Deck of the note's first card. */
  deck: string;
  cards: CardState[];
}

/** Error for a missing capability or an unusable request (as opposed to a transport error). */
export class AnkiActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnkiActionError";
  }
}

const TYPES: CardType[] = ["new", "learning", "review", "relearning"];

function toCardState(c: CardInfo): CardState {
  return {
    cardId: c.cardId,
    type: TYPES[c.type] ?? "new",
    suspended: c.queue === -1,
    buried: c.queue === -2 || c.queue === -3,
    intervalDays: c.interval > 0 ? c.interval : 0,
  };
}

/** Largest "due in N days" that is spelled out exactly; further away only a bucket is shown. */
const EXACT_DUE_DAYS = 14;

/** "due today" / "due tomorrow" / "due in N days" text for a probe result. */
function dueLabel(days: number): string {
  if (days <= 0) return "due today";
  return days === 1 ? "due tomorrow" : `due in ${days} days`;
}

/**
 * Due text for review cards. The legacy API only returns the raw due day, so we ask Anki's
 * search (`prop:due=N`) in one `multi` request. Best effort: an empty map if that fails.
 */
async function reviewDueTexts(
  anki: AnkiConnectClient,
  cardIds: number[],
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (cardIds.length === 0) return out;
  const ids = cardIds.join(",");
  const probes: { query: string; text: string }[] = [
    { query: "prop:due<=0", text: dueLabel(0) },
    ...Array.from({ length: EXACT_DUE_DAYS }, (_, i) => ({
      query: `prop:due=${i + 1}`,
      text: dueLabel(i + 1),
    })),
    { query: "prop:due<=30", text: "due within a month" },
    { query: "prop:due<=90", text: "due within three months" },
    { query: "prop:due>90", text: "due in more than three months" },
  ];
  try {
    const results = await anki.invoke<(number[] | { error: string })[]>("multi", {
      actions: probes.map((p) => ({
        action: "findCards",
        version: 6,
        params: { query: `cid:${ids} ${p.query}` },
      })),
    });
    probes.forEach((p, i) => {
      const hit = results[i];
      if (!Array.isArray(hit)) return;
      for (const id of hit) if (!out.has(id)) out.set(id, p.text);
    });
  } catch {
    // The due text is cosmetic; the status stays correct without it.
  }
  return out;
}

/**
 * Live state of the cards of the given notes, read at click time (never from the snapshot).
 * Notes that no longer exist are omitted.
 *
 * @throws AnkiConnectError when Anki is unreachable.
 */
export async function cardStatus(
  anki: AnkiConnectClient,
  noteIds: number[],
): Promise<{ notes: NoteCardStatus[] }> {
  if (noteIds.length === 0) return { notes: [] };
  const infos = (await anki.notesInfo(noteIds)).filter((n) => n && n.noteId);
  const cards = await anki.cardsInfo(infos.flatMap((n) => n.cards));
  const byId = new Map(cards.map((c) => [c.cardId, c]));
  const states = new Map(cards.map((c) => [c.cardId, toCardState(c)]));
  const due = await reviewDueTexts(
    anki,
    [...states.values()].filter((s) => s.type === "review" && !s.suspended).map((s) => s.cardId),
  );
  for (const [id, text] of due) {
    const s = states.get(id);
    if (s) s.dueText = text;
  }
  return {
    notes: infos.map((n) => {
      const own = n.cards.flatMap((id) => states.get(id) ?? []);
      return { noteId: n.noteId, deck: byId.get(n.cards[0] ?? 0)?.deckName ?? "", cards: own };
    }),
  };
}

/** Distinct note ids of some cards. */
const notesOf = (cards: CardInfo[]): number[] => [...new Set(cards.map((c) => c.note))];

/**
 * "Learn next": move the new cards among `cardIds` to the front of their deck's new queue,
 * unsuspending suspended ones, and tag their notes `kenning::reading`. Cards that are not
 * new are ignored. Never shifts existing cards (that would force a full sync).
 *
 * @returns ids of the cards that were repositioned and of those that were unsuspended.
 * @throws AnkiActionError when AnkiConnect has no v1 API; AnkiConnectError on Anki failures.
 */
export async function learnNext(
  anki: AnkiConnectClient,
  cardIds: number[],
): Promise<{ repositioned: number[]; unsuspended: number[] }> {
  const fresh = (await anki.cardsInfo(cardIds)).filter((c) => c.type === 0);
  if (fresh.length === 0) return { repositioned: [], unsuspended: [] };
  if (!(await anki.hasV1())) {
    throw new AnkiActionError("Learn next needs AnkiConnect with API v1 (Anki ≥ 26.08)");
  }
  const ids = fresh.map((c) => c.cardId);
  const suspended = fresh.filter((c) => c.queue === -1).map((c) => c.cardId);
  await anki.invoke("addTags", { notes: notesOf(fresh), tags: TAG_READING });
  // Unsuspend first: repositioning only accepts active new cards.
  if (suspended.length > 0) await anki.invoke("unsuspend", { cards: suspended });
  await anki.rpc("scheduling.repositionNewCards", {
    cardIds: ids.map(String),
    startingFrom: 0,
    stepSize: 1,
    randomize: false,
    shiftExisting: false,
  });
  return { repositioned: ids, unsuspended: suspended };
}

/**
 * "Mark known": give every card an interval of 21–35 days (so it reads back as mature),
 * unsuspend suspended ones and tag their notes `kenning::known`. Works on cards in any state;
 * it is the user's explicit statement that they know the word.
 *
 * @returns ids of the cards that were updated.
 */
export async function markKnownInAnki(
  anki: AnkiConnectClient,
  cardIds: number[],
): Promise<{ updated: number[] }> {
  const cards = await anki.cardsInfo(cardIds);
  if (cards.length === 0) return { updated: [] };
  const ids = cards.map((c) => c.cardId);
  const suspended = cards.filter((c) => c.queue === -1).map((c) => c.cardId);
  if (suspended.length > 0) await anki.invoke("unsuspend", { cards: suspended });
  await anki.invoke("setDueDate", { cards: ids, days: KNOWN_DUE_DATE });
  await anki.invoke("addTags", { notes: notesOf(cards), tags: TAG_KNOWN });
  return { updated: ids };
}

/**
 * Mark known a word that is not in Anki yet: add the note (Kenning deck, Kenning Word type;
 * an existing identical note is reused) and then mark its new card(s) known.
 */
export async function addNoteAsKnown(
  anki: AnkiConnectClient,
  note: NewWordNote,
): Promise<{ noteId: number; cardIds: number[] }> {
  const noteId = await addWordNote(anki, note);
  const [info] = await anki.notesInfo([noteId]);
  const cardIds = info?.cards ?? [];
  if (cardIds.length === 0) {
    throw new AnkiConnectError(`note ${noteId} has no cards to mark known`, "addNote");
  }
  await markKnownInAnki(anki, cardIds);
  return { noteId, cardIds };
}
