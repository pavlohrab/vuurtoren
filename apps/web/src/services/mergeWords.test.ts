import { describe, expect, it } from "vitest";
import type { NativeWordNote } from "@app/db";
import { exactMerges, mergeEvents, nearPairs } from "./mergeWords.js";

const word = (
  id: number,
  key: string,
  origin: string,
  reviews: number,
  extra: Partial<NativeWordNote["note"]> = {},
): NativeWordNote => ({
  note: { id, notetypeId: "t", fields: [key], tags: [], key, ...extra },
  origin,
  reviews,
});

describe("one card per word", () => {
  it("keeps the note with the answers and gives it what Vuurtoren's copy had", () => {
    const plans = exactMerges([
      word(5, "fiets", "vuurtoren", 0, { article: "de", sentence: "Ik fiets.", audio: "word-1" }),
      word(20, "fiets", "apkg", 23, { gloss: "bike" }),
    ]);
    expect(plans).toEqual([
      { keep: 20, fill: { article: "de", sentence: "Ik fiets.", audio: "word-1" }, remove: [5] },
    ]);
    expect(mergeEvents("nl", plans)).toEqual([
      {
        type: "NativeNotesFilled",
        lang: "nl",
        notes: [{ id: 20, fill: { article: "de", sentence: "Ik fiets.", audio: "word-1" } }],
      },
      { type: "NativeNotesRemoved", lang: "nl", noteIds: [5] },
    ]);
  });

  it("by itself never removes a note from Anki or a file, and keeps Vuurtoren's when it has more answers", () => {
    expect(
      exactMerges([
        word(5, "kat", "vuurtoren", 9),
        word(20, "kat", "apkg", 2),
        word(30, "hond", "anki", 1),
        word(31, "hond", "apkg", 4),
      ]),
    ).toEqual([]);
  });

  it("finds near matches: a plural, a word one letter off; not two different words", () => {
    const pairs = nearPairs([
      word(1, "huis", "vuurtoren", 12),
      word(2, "huizen", "apkg", 4),
      word(3, "fiets", "apkg", 23),
      word(4, "fietsen", "vuurtoren", 0),
      word(5, "boek", "apkg", 3),
      word(6, "boot", "apkg", 3),
      word(7, "straat", "apkg", 1),
      word(8, "straag", "vuurtoren", 0),
    ]);
    expect(pairs.map((p) => [p.keep.note.key, p.drop.note.key, p.why])).toEqual([
      ["fiets", "fietsen", "form"],
      ["straat", "straag", "spelling"],
    ]);
    // A pair kept apart is not asked again.
    expect(
      nearPairs(
        [word(3, "fiets", "apkg", 23), word(4, "fietsen", "vuurtoren", 0)],
        new Set(["3-4"]),
      ),
    ).toEqual([]);
  });

  it("an alias links a word to its form", () => {
    const pairs = nearPairs([
      word(1, "huis", "vuurtoren", 12, { aliases: ["huizen"] }),
      word(2, "huizen", "apkg", 4),
    ]);
    expect(pairs.map((p) => [p.keep.note.id, p.drop.note.id, p.why])).toEqual([[1, 2, "form"]]);
  });
});
