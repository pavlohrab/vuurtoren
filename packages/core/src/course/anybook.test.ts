/**
 * Course import for books other than the Dutch example: synthetic books (invented text, no
 * copyrighted content) in different outline styles and languages.
 */
import { describe, expect, it } from "vitest";
import {
  assignKinds,
  detectOutline,
  extractNumber,
  readingTexts,
  recognizeExercises,
  segmentPages,
  stripRunningText,
  suggestDecks,
  unitWordLists,
  type OcrPage,
} from "../index.js";

const PROSE =
  "Anna lives in a small town near the sea. Every morning she walks to the market. " +
  "She buys bread, cheese and some fruit for the day. Then she drinks a coffee with her friend Tom. " +
  "They talk about work, the weather and their plans for the weekend.";

/** An English coursebook: contents with "Unit N" entries, running headers, exercises, a glossary by unit. */
function englishBook(): OcrPage[] {
  const pages: OcrPage[] = [];
  const add = (text: string) => pages.push({ n: pages.length + 1, text });
  add("Everyday English\nA course for adults");
  add(
    [
      "Contents",
      "Introduction .... 1",
      "Unit 1 Meeting people .... 2",
      "Unit 2 Food and drink .... 5",
      "Unit 3 Travel .... 8",
      "Grammar reference .... 11",
      "Glossary .... 12",
    ].join("\n"),
  );
  add("Introduction\nHow to use this book.");
  // printed page = pdf page - 2
  const unit = (n: number, title: string, from: number) => {
    add(`Unit ${n} ${title}\n${PROSE}\nEveryday English ${from - 2}`);
    add(
      `Exercise 1 Fill in the gaps.\n1 She ____ (live) in Leeds.\n2 They ____ (work) here.\nEveryday English ${from - 1}`,
    );
    add(
      `Exercise 2 Choose the right answer.\n1 Where does Anna live?\na In a big city.\nb In a small town.\nc On a farm.\n2 What does she buy?\na Bread and cheese.\nb A newspaper.\nEveryday English ${from}`,
    );
  };
  unit(1, "Meeting people", 4);
  unit(2, "Food and drink", 7);
  unit(3, "Travel", 10);
  add("Grammar reference\nThe present simple: I live, she lives.");
  add(
    "Glossary\nUnit 1\nthe neighbour\nto introduce\nUnit 2\nthe bread\nthe market\nUnit 3\nthe ticket\nthe station",
  );
  return pages;
}

/** A German book without a contents page: "Lektion N" headings at the top of pages, "Übung" exercises. */
function germanBook(): OcrPage[] {
  const pages: OcrPage[] = [];
  const add = (text: string) => pages.push({ n: pages.length + 1, text });
  add("Deutsch im Alltag");
  add("Vorwort\nDieses Buch ist für Sie.");
  add("Lektion 1: Hallo!\nGuten Tag. Ich heiße Eva.");
  add("Übung 1 Ergänzen Sie.\n1 Ich ____ (heißen) Eva.\n2 Du ____ (kommen) aus Wien.");
  add("Übung 2 Bilden Sie Sätze.\n1 heiße / ich / Eva\n2 aus Wien / komme / ich");
  add("Lektion 2: Einkaufen\nIch kaufe Brot und Milch. Siehe auch Lektion 1.");
  add(
    "Übung 1 Kreuzen Sie an.\n1 Was kauft Eva?\na Brot.\nb Käse.\n2 Wo kauft sie ein?\na Im Markt.\nb Im Kiosk.",
  );
  add("Lektion 3: Wohnen\nMeine Wohnung ist klein.");
  add("Übung 1 Ergänzen Sie.\n1 Die Wohnung ____ (sein) klein.\n2 Wir ____ (wohnen) in Graz.");
  add(
    "Wortliste\nLektion 1\nder Name\nheißen\nLektion 2\ndas Brot\nkaufen\nLektion 3\ndie Wohnung\nwohnen",
  );
  return pages;
}

describe("any book: English, contents with unit words and printed page offset", () => {
  const pages = englishBook();
  const units = detectOutline(pages, "en");

  it("finds the units from the contents, with the book's own unit word", () => {
    expect(units.map((u) => [u.title, u.kind, u.pages])).toEqual([
      ["Unit 1 Meeting people", "theme", [4, 6]],
      ["Unit 2 Food and drink", "theme", [7, 9]],
      ["Unit 3 Travel", "theme", [10, 12]],
      ["Grammar reference", "grammar", [13, 13]],
      ["Glossary", "wordlist", [14, 14]],
    ]);
  });

  it("recognises English exercise headers and types, and multiple-choice questions", () => {
    const blocks = assignKinds(segmentPages(stripRunningText(pages)), units);
    const u1 = units[0]!;
    const ex = recognizeExercises(
      blocks.filter((b) => b.page >= u1.pages[0] && b.page <= u1.pages[1]),
    );
    expect(ex.map((e) => [e.number, e.type, e.items.length])).toEqual([
      [1, "gapfill", 2],
      [2, "choice", 2],
    ]);
    expect(ex[1]?.items[0]?.options).toEqual(["In a big city.", "In a small town.", "On a farm."]);
    expect(readingTexts(blocks, u1).map((t) => t.kind)).toEqual(["text"]);
  });

  it("reads the glossary by unit", () => {
    const blocks = assignKinds(segmentPages(stripRunningText(pages)), units);
    const lists = unitWordLists(blocks, units);
    expect(lists.get(2)?.map((w) => w.lemma)).toEqual(["the bread", "the market"].map((w) => w));
  });
});

describe("any book: German, no contents page, headings on top of pages", () => {
  const pages = germanBook();
  const units = detectOutline(pages, "de");

  it("finds the units from the headings and the word list appendix", () => {
    expect(units.map((u) => [u.title, u.kind, u.pages])).toEqual([
      ["Lektion 1 Hallo!", "theme", [3, 5]],
      ["Lektion 2 Einkaufen", "theme", [6, 7]],
      ["Lektion 3 Wohnen", "theme", [8, 9]],
      ["Wortliste", "wordlist", [10, 10]],
    ]);
  });

  it("recognises Übung headers: gap fill, sentence building, multiple choice", () => {
    const blocks = assignKinds(segmentPages(stripRunningText(pages)), units);
    const types = units
      .slice(0, 3)
      .map((u) =>
        recognizeExercises(blocks.filter((b) => b.page >= u.pages[0] && b.page <= u.pages[1])).map(
          (e) => e.type,
        ),
      );
    expect(types).toEqual([["gapfill", "sentence-building"], ["choice"], ["gapfill"]]);
  });

  it("maps word list sections and decks by unit number", () => {
    const blocks = assignKinds(segmentPages(stripRunningText(pages)), units);
    expect(
      unitWordLists(blocks, units)
        .get(3)
        ?.map((w) => w.lemma),
    ).toEqual(["die wohnung", "wohnen"]);
    expect(extractNumber("Mein Deutsch::Lektion 02 – Einkaufen")).toBe(2);
    const sug = suggestDecks(units.slice(0, 3), [
      "Mein Deutsch::Lektion 01",
      "Mein Deutsch::Lektion 02::Wörter",
      "Mein Deutsch::Lektion 03 Wohnen",
      "Default",
    ]);
    expect(sug.map((s) => s.decks)).toEqual([
      ["Mein Deutsch::Lektion 01"],
      ["Mein Deutsch::Lektion 02::Wörter"],
      ["Mein Deutsch::Lektion 03 Wohnen"],
    ]);
  });
});
