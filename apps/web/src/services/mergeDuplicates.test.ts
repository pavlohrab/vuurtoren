import { describe, expect, it } from "vitest";
import { duplicatesToRemove } from "./liveNative.js";

describe("one card per word after an import", () => {
  it("keeps the note with the most answers and drops Vuurtoren's copy", () => {
    expect(
      duplicatesToRemove([
        { noteId: 5, key: "kat", origin: "vuurtoren", reviews: 0 },
        { noteId: 20, key: "kat", origin: "apkg", reviews: 12 },
      ]),
    ).toEqual({ remove: [5], merged: 1 });
  });

  it("keeps Vuurtoren's copy when it has more answers, and never drops a note from a file", () => {
    expect(
      duplicatesToRemove([
        { noteId: 5, key: "kat", origin: "vuurtoren", reviews: 9 },
        { noteId: 20, key: "kat", origin: "apkg", reviews: 2 },
        { noteId: 30, key: "hond", origin: "anki", reviews: 1 },
        { noteId: 31, key: "hond", origin: "apkg", reviews: 4 },
      ]),
    ).toEqual({ remove: [], merged: 0 });
  });

  it("on a tie the imported note stays", () => {
    expect(
      duplicatesToRemove([
        { noteId: 5, key: "huis", origin: "vuurtoren", reviews: 0 },
        { noteId: 20, key: "huis", origin: "apkg", reviews: 0 },
      ]),
    ).toEqual({ remove: [5], merged: 1 });
  });
});
