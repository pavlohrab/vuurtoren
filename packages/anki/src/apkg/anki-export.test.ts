/**
 * A package exported by Anki 26.08 itself (current layout: collection.anki21b, zstd, protobuf
 * tables), holding three notes Kenning wrote to Anki: one reviewed, one new, one learning.
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { type OpenSqlite, readAnkiPackage } from "./read.js";

const open: OpenSqlite = async (bytes) => {
  const db = new DatabaseSync(":memory:");
  db.deserialize(bytes);
  return {
    all: async (sql) => db.prepare(sql).all() as Record<string, unknown>[],
    close: async () => db.close(),
  };
};

describe("a package exported by Anki", () => {
  it("reads note types, decks with options and FSRS parameters, notes, cards and history", async () => {
    const bytes = new Uint8Array(
      readFileSync(new URL("./fixtures/anki-26.08.apkg", import.meta.url)),
    );
    const col = await readAnkiPackage(bytes, open);
    expect(col.notetypes.map((t) => t.name)).toContain("Kenning Word");
    const deck = col.decks.find((d) => d.name === "Kenning::Nederlands")!;
    expect(deck.options.desiredRetention).toBeCloseTo(0.85, 5);
    expect(deck.fsrsParams).toHaveLength(21);
    expect(col.notes.map((n) => n.fields[0]).sort()).toEqual(["boom", "fiets", "huis"]);
    expect(col.cards.map((c) => c.type).sort()).toEqual([0, 1, 2]);
    expect(col.cards.find((c) => c.type === 2)!.intervalDays).toBeGreaterThan(0);
    expect(col.reviews).toHaveLength(4);
  });
});
