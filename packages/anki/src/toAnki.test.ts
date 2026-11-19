import { describe, expect, it } from "vitest";
import {
  type CardReview,
  DEFAULT_DECK_OPTIONS,
  type NativeCard,
  type NativeNote,
  type NativeNotetype,
  answerCard,
} from "@app/core";
import { AnkiConnectClient } from "./client.js";
import { fakeAnkiWrite, fakeCollection } from "./fake-anki-write.test-util.js";
import { KENNING_NOTETYPE } from "./native.js";
import { NOTE_TYPE } from "./note.js";
import { TAG_MOVED, moveToAnki, wordFields } from "./toAnki.js";

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 19, 12).getTime();
const ctx = { options: DEFAULT_DECK_OPTIONS, params: [] as number[], fuzz: false };

const IMPORTED: NativeNotetype = {
  id: "anki:5",
  name: "Dutch",
  kind: "standard",
  fields: ["Woord", "Betekenis", "Plaatje"],
  templates: [{ name: "Card 1", front: "{{Woord}}", back: "{{Betekenis}}" }],
  css: "",
  vocab: { word: "Woord", gloss: "Betekenis" },
};
const OTHER: NativeNotetype = {
  id: "anki:6",
  name: "Grammar",
  kind: "standard",
  fields: IMPORTED.fields,
  templates: IMPORTED.templates,
  css: "",
};

function collection() {
  const t0 = NOW - 20 * DAY;
  const reviews: CardReview[] = [
    { cardId: 201, at: t0, rating: 3, kind: "learn", durationMs: 4000 },
    { cardId: 201, at: t0 + 10 * 60_000, rating: 3, kind: "learn", durationMs: 3000 },
    { cardId: 201, at: t0 + 4 * DAY, rating: 3, kind: "review", durationMs: 2000 },
    // A card that came from Anki: its first answer is already in Anki's history.
    { cardId: 30, at: t0 - DAY, rating: 3, kind: "learn", durationMs: 1000 },
    { cardId: 30, at: t0 + DAY, rating: 3, kind: "review", durationMs: 1000 },
  ];
  let s = answerCard(undefined, 3, reviews[0]!.at, ctx);
  s = answerCard(s, 3, reviews[1]!.at, ctx);
  s = answerCard(s, 3, reviews[2]!.at, ctx);
  let t = answerCard(undefined, 3, reviews[3]!.at, ctx);
  t = answerCard(t, 3, reviews[4]!.at, ctx);
  const notes: NativeNote[] = [
    {
      id: 101,
      notetypeId: "kenning-word",
      fields: ["fiets", "bicycle", "", "", ""],
      tags: ["kenning"],
      key: "fiets",
    },
    {
      id: 102,
      notetypeId: "kenning-word",
      fields: ["huis", "house", "", "", ""],
      tags: [],
      key: "huis",
    },
    { id: 103, notetypeId: "anki:5", fields: ["de boom", "tree", ""], tags: ["nl"], key: "boom" },
    { id: 104, notetypeId: "anki:6", fields: ["V2", "verb second", ""], tags: [] },
    { id: 3, notetypeId: "anki:5", fields: ["kat", "cat", ""], tags: [], key: "kat" },
  ];
  const cards: NativeCard[] = [
    { id: 201, noteId: 101, ord: 0, deck: "Kenning::Nederlands", position: 0, schedule: s },
    { id: 202, noteId: 102, ord: 0, deck: "Kenning::Nederlands", position: 1, suspended: true },
    { id: 203, noteId: 103, ord: 0, deck: "Opmaat", position: 2 },
    { id: 204, noteId: 104, ord: 0, deck: "Opmaat", position: 3 },
    { id: 30, noteId: 3, ord: 0, deck: "Dutch", position: 4, schedule: t },
  ];
  return {
    notetypes: [KENNING_NOTETYPE, IMPORTED, OTHER],
    decks: [{ name: "Kenning::Nederlands", options: DEFAULT_DECK_OPTIONS }],
    notes,
    cards,
    reviews,
    now: NOW,
    s,
    t,
  };
}

function anki() {
  // Anki already has note 3 (card 30) with its first answer.
  const col = fakeCollection([
    { id: 30, note: 3, deck: "Dutch", type: 2, queue: 2, interval: 2, due: 0 },
  ]);
  col.revlog = [[NOW - 21 * DAY, 30, 0, 3, 2, 0, 2500, 1000, 0]];
  return { col, client: new AnkiConnectClient({ fetch: fakeAnkiWrite(col) }) };
}

describe("moveToAnki", () => {
  it("adds words as Kenning notes, keeps Anki's own, gives reviewed cards their due date", async () => {
    const c = collection();
    const { col, client } = anki();
    const r = await moveToAnki(client, { ...c, withHistory: false });
    expect(r).toMatchObject({ added: 3, existing: 1, skipped: 1, scheduled: 2, reviews: 0 });
    expect(r.decks).toEqual(["Dutch", "Kenning::Nederlands", "Opmaat"]);
    expect(col.models.has(NOTE_TYPE)).toBe(true);
    const added = [...col.notes].filter(([id]) => id !== 3);
    expect(added.map(([, n]) => [n.deck, n.fields["Word"], n.fields["Gloss"]])).toEqual([
      ["Kenning::Nederlands", "fiets", "bicycle"],
      ["Kenning::Nederlands", "huis", "house"],
      ["Opmaat", "de boom", "tree"],
    ]);
    expect(col.tags.get(added[0]![0])?.has(TAG_MOVED)).toBe(true);
    // fiets: due on the same study day, that gap as its interval; huis: new and suspended.
    const fiets = col.cards.find((x) => x.note === added[0]![0])!;
    const days = Math.round((c.s.due - NOW) / DAY);
    expect(fiets).toMatchObject({ type: 2 });
    expect(Math.abs(fiets.interval - days)).toBeLessThanOrEqual(1);
    expect(col.cards.find((x) => x.note === added[1]![0])).toMatchObject({ type: 0, queue: -1 });
    expect(col.cards.find((x) => x.id === 30)).toMatchObject({ type: 2 });
    expect(col.revlog).toHaveLength(1);
  });

  it("with history: exact intervals and the answers Anki does not have yet", async () => {
    const c = collection();
    const { col, client } = anki();
    const r = await moveToAnki(client, { ...c, withHistory: true });
    // fiets: 3 answers on its new card; kat: only the answer given in Kenning.
    expect(r.reviews).toBe(4);
    const fietsCard = col.cards.find(
      (x) => x.note === [...col.notes.keys()].find((id) => id !== 3),
    )!;
    expect(col.revlog!.filter((x) => x[1] === fietsCard.id).map((x) => x[3])).toEqual([3, 3, 3]);
    expect(col.revlog!.filter((x) => x[1] === 30)).toHaveLength(2);
    expect(fietsCard.interval).toBe(Math.round(c.s.scheduledDays));
    expect(col.values?.get(`${fietsCard.id}:reps`)).toBe(c.s.reps);
  });

  it("maps an imported word type onto Kenning's fields, and skips notes without a word", () => {
    expect(wordFields(collection().notes[2]!, IMPORTED)).toEqual({
      Word: "de boom",
      Gloss: "tree",
      Sentence: "",
      SentenceTranslation: "",
      Source: "",
    });
    expect(wordFields(collection().notes[3]!, OTHER)).toBeNull();
  });
});
