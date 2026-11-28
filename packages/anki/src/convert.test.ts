import type { NativeCard, NativeNote, NativeNotetype } from "@app/core";
import { describe, expect, it } from "vitest";
import {
  RARER_DECK,
  convertWordNote,
  convertedPosition,
  picturesOf,
  rarerGroupOf,
  wordsToConvert,
} from "./convert.js";
import { VUURTOREN_NOTETYPE } from "./native.js";
import { starterDeck } from "./starter.js";

const BASIC: NativeNotetype = {
  id: "1",
  name: "Basic",
  kind: "standard",
  fields: ["Front", "Back", "Picture"],
  templates: [{ name: "Card 1", front: "{{Front}}", back: "{{Back}}" }],
  css: "",
  vocab: { word: "Front", gloss: "Back" },
};
const CLOZE: NativeNotetype = { ...BASIC, id: "2", kind: "cloze", fields: ["Text"] };

const note = (id: number, fields: string[], key?: string, type = "1"): NativeNote => ({
  id,
  notetypeId: type,
  fields,
  tags: ["dutch"],
  ...(key ? { key } : {}),
});
const card = (id: number, noteId: number, ord = 0): NativeCard => ({
  id,
  noteId,
  ord,
  deck: "Dutch::Week 3",
  position: id,
});

describe("Anki words to Vuurtoren words", () => {
  const fiets = note(10, ["fiets", "bike", '<img src="fiets.jpg">'], "fiets");
  const col = {
    notetypes: [BASIC, CLOZE],
    notes: [
      fiets,
      note(20, ["{{c1::Ik}} loop."], undefined, "2"),
      note(30, ["Ik ga naar huis.", "I go home."]),
      note(40, ["huis", "house"], "huis"),
    ],
    cards: [card(11, 10), card(21, 20), card(31, 30), card(41, 40), card(42, 40, 2)],
  };

  it("takes word notes only, with one or two templates", () => {
    const words = wordsToConvert(col);
    expect(words.map((w) => w.key)).toEqual(["fiets"]);
    expect(words[0]).toMatchObject({ word: "fiets", gloss: "bike", hasPicture: true });
  });

  it("leaves Vuurtoren's own words alone", () => {
    const own = note(50, ["de kat", "cat"], "kat", VUURTOREN_NOTETYPE.id);
    const words = wordsToConvert({
      notetypes: [VUURTOREN_NOTETYPE],
      notes: [own],
      cards: [card(51, 50)],
    });
    expect(words).toEqual([]);
  });

  it("makes a starter word the starter's note, keeping the id, tags and picture", async () => {
    const c = await convertWordNote(
      fiets,
      {
        rank: 120,
        word: "fiets",
        pos: "noun",
        article: "de",
        gloss: "bike, bicycle",
        sentence: "Ik ga met de fiets naar mijn werk.",
      },
      undefined,
    );
    expect(c!.deck).toBe(starterDeck(1));
    expect(c!.note).toMatchObject({
      id: 10,
      tags: ["dutch"],
      notetypeId: VUURTOREN_NOTETYPE.id,
      key: "fiets",
      article: "de",
      gloss: "bike, bicycle",
    });
    expect(c!.note.fields[0]).toBe("de fiets");
    expect(c!.note.fields[2]).toContain("fiets");
    expect(c!.note.fields.at(-1)).toBe('<img src="fiets.jpg">');
    expect(c!.note.audio).toMatch(/^word-/);
  });

  it("makes a rarer word from the dictionary, into Rarer words", async () => {
    const zeis = note(60, ["zeis", "scythe"], "zeis");
    const c = await convertWordNote(zeis, undefined, { gloss: "scythe", article: "de", zipf: 2.4 });
    expect(c!.deck).toBe(RARER_DECK);
    expect(c!.note).toMatchObject({ id: 60, key: "zeis", zipf: 2.4, article: "de" });
    expect(c!.note.fields.slice(0, 2)).toEqual(["de zeis", "scythe"]);
  });

  it("keeps a word no one knows an Anki card", async () => {
    expect(await convertWordNote(note(70, ["blorp", "?"], "blorp"), undefined, undefined)).toBe(
      null,
    );
  });

  it("finds pictures, groups rarer words and orders the new queue", () => {
    expect(picturesOf(["a <img src='x.png'> b", "<IMG SRC=y.jpg>"])).toBe(
      "<img src='x.png'> <IMG SRC=y.jpg>",
    );
    expect([3.7, 3.2, 1.5].map(rarerGroupOf)).toEqual(["5,000–10,000", "10,000–20,000", "rarer"]);
    expect(convertedPosition(120, undefined)).toBe(120);
    expect(convertedPosition(undefined, 3.5)).toBeLessThan(convertedPosition(undefined, 2));
  });
});
