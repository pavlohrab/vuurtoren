/**
 * Writing a package and reading it back: what Kenning writes, Kenning (and Anki) reads.
 */
import { DatabaseSync } from "node:sqlite";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  type CardReview,
  DEFAULT_DECK_OPTIONS,
  type NativeCard,
  type NativeNote,
  answerCard,
} from "@app/core";
import { KENNING_NOTETYPE } from "../native.js";
import { type OpenSqlite, readAnkiPackage } from "./read.js";
import { type CreateSqlite, KENNING_NOTETYPE_ANKI_ID, writeAnkiPackage } from "./write.js";

const create: CreateSqlite = async () => {
  const db = new DatabaseSync(":memory:");
  return {
    exec: async (sql, params = []) => {
      db.prepare(sql).run(...params);
    },
    bytes: async () => new Uint8Array(db.serialize()),
    close: async () => db.close(),
  };
};
const open: OpenSqlite = async (bytes) => {
  const db = new DatabaseSync(":memory:");
  db.deserialize(bytes);
  return {
    all: async (sql) => db.prepare(sql).all() as Record<string, unknown>[],
    close: async () => db.close(),
  };
};

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 19, 12);
const ctx = { options: DEFAULT_DECK_OPTIONS, params: [] as number[], fuzz: false };

function input() {
  const note = (id: number, word: string, gloss: string, extra = ""): NativeNote => ({
    id,
    notetypeId: KENNING_NOTETYPE.id,
    fields: [word, gloss, `Ik zie ${word}.${extra}`, "", ""],
    tags: ["kenning"],
    key: word,
  });
  // A card learned 10 days ago and reviewed since; a new card; a suspended new card.
  const t0 = NOW - 10 * DAY;
  const reviews: CardReview[] = [
    { cardId: 201, at: t0, rating: 3, kind: "learn", durationMs: 4000 },
    { cardId: 201, at: t0 + 10 * 60_000, rating: 3, kind: "learn", durationMs: 3000 },
    { cardId: 201, at: t0 + 3 * DAY, rating: 3, kind: "review", durationMs: 2000 },
  ];
  let s = answerCard(undefined, 3, reviews[0]!.at, ctx);
  s = answerCard(s, 3, reviews[1]!.at, ctx);
  s = answerCard(s, 3, reviews[2]!.at, ctx);
  const cards: NativeCard[] = [
    { id: 201, noteId: 101, ord: 0, deck: "Kenning::Nederlands", position: 0, schedule: s },
    { id: 202, noteId: 102, ord: 0, deck: "Kenning::Nederlands", position: 5 },
    {
      id: 203,
      noteId: 103,
      ord: 0,
      deck: "Kenning::Nederlands::Talk",
      position: 1,
      suspended: true,
    },
  ];
  return {
    notetypes: [KENNING_NOTETYPE],
    decks: [
      {
        name: "Kenning::Nederlands",
        options: { ...DEFAULT_DECK_OPTIONS, desiredRetention: 0.85, newPerDay: 12 },
      },
      { name: "Kenning::Nederlands::Talk", options: DEFAULT_DECK_OPTIONS },
    ],
    notes: [
      note(101, "fiets", "bicycle", '<img src="fiets.png">'),
      note(102, "huis", "house"),
      note(103, "gezellig", "cosy"),
    ],
    cards,
    reviews,
    media: [
      { name: "fiets.png", bytes: async () => new Uint8Array([1, 2, 3]) },
      { name: "unused.png", bytes: async () => new Uint8Array([9]) },
    ],
    now: NOW,
    schedule: s,
  };
}

describe("writeAnkiPackage", () => {
  it("writes notes, cards, decks with options, history and used media that read back", async () => {
    const inp = input();
    const { bytes, summary } = await writeAnkiPackage(inp, create);
    expect(summary).toEqual({ notes: 3, cards: 3, reviews: 3, media: 1 });
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual(["0", "collection.anki21", "media"]);
    expect(JSON.parse(new TextDecoder().decode(files["media"]))).toEqual({ "0": "fiets.png" });

    const col = await readAnkiPackage(bytes, open);
    expect(col.notetypes.map((t) => [t.id, t.name, t.fields])).toEqual([
      [KENNING_NOTETYPE_ANKI_ID, KENNING_NOTETYPE.name, KENNING_NOTETYPE.fields],
    ]);
    // Parent decks come along; options per deck.
    expect(col.decks.map((d) => d.name).sort()).toEqual([
      "Default",
      "Kenning",
      "Kenning::Nederlands",
      "Kenning::Nederlands::Talk",
    ]);
    const nl = col.decks.find((d) => d.name === "Kenning::Nederlands")!;
    expect(nl.options.desiredRetention).toBe(0.85);
    expect(nl.options.newPerDay).toBe(12);
    expect(col.notes.map((n) => n.fields[0])).toEqual(["fiets", "huis", "gezellig"]);

    const byId = new Map(col.cards.map((c) => [c.id, c]));
    const review = byId.get(201)!;
    expect(review.type).toBe(2);
    expect(review.intervalDays).toBe(Math.round(inp.schedule.scheduledDays));
    // The due day survives the round trip (to the study day).
    expect(Math.abs(review.dueMs! - inp.schedule.due)).toBeLessThan(DAY);
    expect(byId.get(202)).toMatchObject({ type: 0, queue: 0, newPosition: 2 });
    expect(byId.get(203)).toMatchObject({ type: 0, queue: -1 });

    expect(col.reviews.map((r) => [r.cardId, r.ease, r.type, r.timeMs])).toEqual([
      [201, 3, 0, 4000],
      [201, 3, 0, 3000],
      [201, 3, 1, 2000],
    ]);
    expect(await col.media[0]!.bytes()).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("keeps the FSRS memory in the card's data and the parameters in the deck preset", async () => {
    const inp = input();
    const params = Array.from({ length: 21 }, (_, i) => i / 10);
    const { bytes } = await writeAnkiPackage({ ...inp, params }, create);
    const db = new DatabaseSync(":memory:");
    db.deserialize(unzipSync(bytes)["collection.anki21"]!);
    const data = JSON.parse(
      String((db.prepare("SELECT data FROM cards WHERE id = 201").get() as { data: string }).data),
    );
    expect(data.s).toBeCloseTo(inp.schedule.stability, 3);
    expect(data.d).toBeCloseTo(inp.schedule.difficulty, 2);
    expect(data.dr).toBe(0.85);
    const dconf = JSON.parse(
      String((db.prepare("SELECT dconf FROM col").get() as { dconf: string }).dconf),
    );
    expect(
      Object.values(dconf).every((c) => (c as { fsrsParams6: number[] }).fsrsParams6.length === 21),
    ).toBe(true);
    // Unique revlog ids, a stable guid per note.
    const guids = db.prepare("SELECT guid FROM notes ORDER BY id").all() as { guid: string }[];
    expect(guids.map((g) => g.guid)).toEqual(["kenning2t", "kenning2u", "kenning2v"]);
  });
});
