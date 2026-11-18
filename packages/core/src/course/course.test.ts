import { describe, expect, it } from "vitest";
import {
  assignKinds,
  bookItemKeys,
  checkBookItem,
  deckScore,
  detectOutline,
  footerTheme,
  isExerciseWord,
  pageOffset,
  parseContents,
  parseExerciseHeader,
  parseWordLine,
  parseWordList,
  readingTexts,
  recognizeExercise,
  segmentPages,
  stripRunningText,
  suggestDecks,
  unitStatus,
  unitWordLists,
  validateOutline,
  type ExerciseItem,
  type OcrPage,
  type Unit,
} from "../index.js";

/** A small invented book: contents, two themes with footers, grammar, transcripts, word list. */
function book(): OcrPage[] {
  const pages: OcrPage[] = [];
  const add = (text: string) => pages.push({ n: pages.length + 1, text });
  add("Nederlands voor beginners\nA2");
  add(
    [
      "Inhoud",
      "Voorwoord ........ 3",
      "1 Kennismaken en afspreken ........ 5",
      "2 Boodschappen doen ........ 9",
      "Grammatica",
      "1 Het verbum ........ 13",
      "2 De zinsbouw ........ 14",
      "Transcripten luisterteksten ........ 15",
      "Woordenlijst ........ 16",
    ].join("\n"),
  );
  add("");
  add("");
  // printed page = pdf page - 2 (pdf 5 is printed 3)
  add("Voorwoord\nDit boek is voor jou.");
  add("");
  for (let p = 7; p <= 10; p++)
    add(`Tekst\nIets op pagina ${p}.\nThema 1 Kennismaken en afspreken ${p - 2}`);
  for (let p = 11; p <= 14; p++) add(`Oefening ${p}\nVul in.\nThema 2 Boodschappen doen ${p - 2}`);
  add("Het verbum\nPresens: ik woon, jij woont.");
  add("De zinsbouw\nHoofdzin: subject, verbum, rest.");
  add("Transcripten luisterteksten");
  add("Woordenlijst");
  return pages;
}

describe("outline detection", () => {
  it("reads a footer line with theme number, title and printed page", () => {
    const f = footerTheme({ n: 17, text: "Some text\nThema 3 Boodschappen doen 15" });
    expect(f).toEqual({ page: 17, word: "Thema", n: 3, title: "Boodschappen doen", printed: 15 });
    expect(footerTheme({ n: 1, text: "Geen voettekst hier" })).toBeNull();
  });

  it("estimates the printed-page offset from footers", () => {
    const pages = book();
    expect(pageOffset(pages.flatMap((p) => footerTheme(p) ?? []))).toBe(2);
  });

  it("parses the contents with grammar chapters", () => {
    const entries = parseContents(book());
    expect(entries.map((e) => [e.title, e.page, e.inGrammar])).toEqual([
      ["Voorwoord", 3, false],
      ["Kennismaken en afspreken", 5, false],
      ["Boodschappen doen", 9, false],
      ["Het verbum", 13, true],
      ["De zinsbouw", 14, true],
      ["Transcripten luisterteksten", 15, true],
      ["Woordenlijst", 16, true],
    ]);
  });

  it("builds themes and appendices with page ranges shifted by the offset", () => {
    const pages = book();
    const units = detectOutline(pages, "c1");
    expect(units.map((u) => [u.n, u.title, u.kind, u.pages])).toEqual([
      [1, "Thema 1 Kennismaken en afspreken", "theme", [7, 10]],
      [2, "Thema 2 Boodschappen doen", "theme", [11, 14]],
      [3, "Grammatica", "grammar", [15, 16]],
      [4, "Transcripten luisterteksten", "transcripts", [17, 17]],
      [5, "Woordenlijst", "wordlist", [18, 18]],
    ]);
    expect(units.every((u) => u.courseId === "c1" && u.ankiDecks.length === 0)).toBe(true);
  });

  it("falls back to footers without a contents page", () => {
    const pages = book().map((p) => (p.n === 2 ? { ...p, text: "" } : p));
    const units = detectOutline(pages, "c1");
    expect(units.map((u) => [u.title, u.pages])).toEqual([
      ["Thema 1 Kennismaken en afspreken", [7, 10]],
      ["Thema 2 Boodschappen doen", [11, 16]],
      // Without contents, appendix headings at the top of later pages still start units.
      ["Transcripten luisterteksten", [17, 17]],
      ["Woordenlijst", [18, 18]],
    ]);
  });

  it("falls back to one unit for the whole book", () => {
    const units = detectOutline(
      [
        { n: 1, text: "Hallo" },
        { n: 2, text: "Wereld" },
      ],
      "c1",
    );
    expect(units).toEqual([
      { courseId: "c1", n: 1, title: "Whole book", pages: [1, 2], ankiDecks: [], kind: "other" },
    ]);
  });
});

describe("outline validation", () => {
  const row = (title: string, from: number, to: number) => ({
    title,
    pages: [from, to] as [number, number],
  });
  it("accepts a clean outline", () => {
    expect(validateOutline([row("A", 1, 10), row("B", 11, 20)], 20)).toBeNull();
    expect(validateOutline([row("B", 11, 20), row("A", 1, 10)], 0)).toBeNull();
  });
  it("names the problem", () => {
    expect(validateOutline([], 10)).toMatch(/at least one unit/);
    expect(validateOutline([row("A", 5, 3)], 10)).toBe(
      "A: the first page comes after the last page.",
    );
    expect(validateOutline([row("A", 0, 3)], 10)).toMatch(/whole numbers from 1/);
    expect(validateOutline([row("A", 1.5, 3)], 10)).toMatch(/whole numbers/);
    expect(validateOutline([row("A", 1, 30)], 20)).toBe("A: the book has only 20 pages.");
    expect(validateOutline([row("A", 1, 10), row("", 10, 12)], 20)).toBe(
      "A and Unit 2 share page 10.",
    );
  });
});

describe("segmentation", () => {
  it("recognises exercise headers, also OCR-damaged ones", () => {
    expect(isExerciseWord("Oefeninq")).toBe(true);
    expect(isExerciseWord("Oetening")).toBe(true);
    expect(isExerciseWord("Opdracht")).toBe(true);
    expect(isExerciseWord("Afbeelding")).toBe(false);
    expect(parseExerciseHeader("Luisteren en spreken Oefening 7 Luister.")).toEqual({
      word: "Oefening",
      skill: "Luisteren en spreken",
      number: 7,
      rest: "Luister.",
    });
    expect(parseExerciseHeader("Oefening")).toBeNull();
  });

  it("strips footers and page numbers, then splits pages into blocks", () => {
    const pages: OcrPage[] = [
      { n: 1, text: "Oefening 1 Vul in.\nAnne _____ (wonen) in Nijmegen.\nThema 1 Kennismaken 12" },
      { n: 2, text: "Piet _____ (werken) hier.\n13\nOefening 2\nKies.\nThema 1 Kennismaken 13" },
    ];
    const blocks = segmentPages(stripRunningText(pages));
    expect(blocks.map((b) => [b.kind, b.label, b.page])).toEqual([
      ["exercise", "Oefening 1", 1],
      ["exercise", "Oefening 2", 2],
    ]);
    // The first exercise continues across the page break; footer and number are gone.
    expect(blocks[0]?.text).toContain("Piet _____ (werken) hier.");
    expect(blocks[0]?.text).not.toMatch(/Kennismaken|13/);
  });

  it("assigns kinds from the outline", () => {
    const units: Unit[] = [
      { courseId: "c", n: 1, title: "Thema 1 X", pages: [1, 1], ankiDecks: [], kind: "theme" },
      {
        courseId: "c",
        n: 2,
        title: "Woordenlijst",
        pages: [2, 2],
        ankiDecks: [],
        kind: "wordlist",
      },
      { courseId: "c", n: 3, title: "Grammatica", pages: [3, 3], ankiDecks: [], kind: "grammar" },
    ];
    const kinds = assignKinds(
      [
        { page: 1, kind: "other", text: "a" },
        { page: 2, kind: "other", text: "b", label: "Thema 1" },
        { page: 3, kind: "other", text: "c" },
        { page: 3, kind: "exercise", text: "d", number: 4 },
      ],
      units,
    ).map((b) => b.kind);
    expect(kinds).toEqual(["other", "wordlist", "grammar", "exercise"]);
  });
});

describe("word lists and texts", () => {
  it("parses entries with leading or trailing articles", () => {
    expect(parseWordLine("de boodschap")).toEqual({
      lemma: "boodschap",
      article: "de",
      source: "wordlist",
    });
    expect(parseWordLine("huis, het")).toEqual({
      lemma: "huis",
      article: "het",
      source: "wordlist",
    });
    expect(parseWordLine("afspreken")).toEqual({ lemma: "afspreken", source: "wordlist" });
    expect(parseWordLine("Thema 3")).toBeNull();
    expect(parseWordLine("Waar woon je?")).toBeNull();
    expect(parseWordList("de winkel\nwinkel, de\nkopen").map((w) => w.lemma)).toEqual([
      "winkel",
      "kopen",
    ]);
  });

  it("collects the word list per theme from labelled sections", () => {
    const units: Unit[] = [
      { courseId: "c", n: 1, title: "Thema 1 A", pages: [1, 5], ankiDecks: [], kind: "theme" },
      { courseId: "c", n: 2, title: "Thema 2 B", pages: [6, 9], ankiDecks: [], kind: "theme" },
      {
        courseId: "c",
        n: 3,
        title: "Woordenlijst",
        pages: [10, 11],
        ankiDecks: [],
        kind: "wordlist",
      },
    ];
    const lists = unitWordLists(
      [
        { page: 10, kind: "wordlist", label: "Thema 1", text: "de naam\nwonen" },
        { page: 10, kind: "wordlist", label: "Thema 2", text: "de winkel" },
        { page: 11, kind: "wordlist", label: "Thema 2", text: "kopen\nde winkel" },
      ],
      units,
    );
    expect(lists.get(1)?.map((w) => w.lemma)).toEqual(["naam", "wonen"]);
    expect(lists.get(2)?.map((w) => w.lemma)).toEqual(["winkel", "kopen"]);
  });

  it("finds prose paragraphs and the unit's transcripts", () => {
    const unit: Unit = {
      courseId: "c",
      n: 1,
      title: "Thema 1 Kennismaken",
      pages: [1, 2],
      ankiDecks: [],
      kind: "theme",
    };
    const prose =
      "Anne woont in Nijmegen en werkt bij een groot bedrijf in de stad. Ze fietst elke dag naar haar werk, ook als het regent. " +
      "In het weekend gaat ze graag naar de markt om groente en fruit te kopen. Daarna drinkt ze koffie met haar vrienden in het café.";
    const transcript = Array(25).fill("Hallo, ik ben Piet.").join(" ");
    const texts = readingTexts(
      [
        { page: 1, kind: "other", label: "Tekst", text: `Lees de tekst.\n\n${prose}` },
        { page: 2, kind: "exercise", number: 3, label: "Oefening 3", text: "Vul in.\nkort" },
        { page: 40, kind: "transcript", label: "Thema 1", text: transcript },
        { page: 41, kind: "transcript", label: "Thema 2", text: transcript },
      ],
      unit,
    );
    expect(texts.map((t) => [t.title, t.kind, t.page])).toEqual([
      ["Thema 1 Kennismaken · Tekst", "text", 1],
      ["Thema 1 Kennismaken · luisterteksten", "transcript", 40],
    ]);
    expect(texts[0]?.text).toBe(prose);
  });
});

describe("deck mapping", () => {
  const decks = [
    "De Opmaat A2::Thema 03 – Winkelen",
    "De Opmaat A2::Thema 01 – Kennismaken",
    "Spaans::Les 3",
    "Kenning::Nederlands",
  ];
  it("matches unit numbers and title words, never clashing numbers", () => {
    const unit = { n: 3, title: "Thema 3 Boodschappen doen en winkelen" };
    expect(deckScore(unit, decks[0]!)).toBeGreaterThan(0.8);
    expect(deckScore(unit, decks[1]!)).toBe(0);
    expect(deckScore(unit, decks[3]!)).toBe(0);
  });
  it("suggests each deck for its best unit only", () => {
    const units = [
      { n: 1, title: "Thema 1 Kennismaken en afspreken" },
      { n: 2, title: "Thema 2 Wonen" },
      { n: 3, title: "Thema 3 Boodschappen doen en winkelen" },
    ];
    const s = suggestDecks(units, decks);
    expect(s.map((x) => [x.n, x.decks])).toEqual([
      [1, ["De Opmaat A2::Thema 01 – Kennismaken"]],
      [2, []],
      [3, ["De Opmaat A2::Thema 03 – Winkelen", "Spaans::Les 3"]],
    ]);
  });
});

describe("unit status", () => {
  it("counts known, learning, new in Anki and missing words, and finished exercises", () => {
    const s = unitStatus(
      [
        { state: "known", inAnki: true },
        { state: "ignored", inAnki: false },
        { state: "learning", inAnki: true },
        { state: "unknown", inAnki: true },
        { state: "absent", inAnki: false },
      ],
      [
        { number: 1, items: 3 },
        { number: 2, items: 2 },
        { number: 3, items: 0 },
      ],
      new Map([
        [1, 3],
        [2, 1],
      ]),
    );
    expect(s).toEqual({
      total: 5,
      known: 2,
      learning: 1,
      newInAnki: 1,
      missing: 1,
      knownRatio: 0.4,
      exercisesDone: 1,
      exercisesTotal: 3,
    });
    expect(unitStatus([], [], new Map()).knownRatio).toBe(0);
  });
});

describe("book exercises", () => {
  it("recognises a gap-fill with lemma hints and checks answers", () => {
    const ex = recognizeExercise({
      page: 5,
      kind: "exercise",
      number: 4,
      label: "Oefening 4",
      text: "Vul de goede vorm van het verbum in.\n1 Anne _____ (wonen) in Nijmegen.\n2 Wij _____ (werken) in Utrecht.",
    });
    expect(ex.number).toBe(4);
    expect(ex.type).toBe("gapfill");
    expect(ex.items.map((i) => i.hint)).toEqual(["wonen", "werken"]);
    const item = { ...ex.items[0]!, answer: "woont", answerSource: "derived" as const };
    expect(checkBookItem("gapfill", item, "woont").correct).toBe(true);
    expect(checkBookItem("gapfill", item, "wonen").correct).toBe(false);
    const noAnswer: (typeof ex.items)[number] = { ...item };
    delete noAnswer.answer;
    expect(checkBookItem("gapfill", noAnswer, "woont").correct).toBeNull();
  });
});

describe("bookItemKeys", () => {
  const item = (o: Partial<ExerciseItem>): ExerciseItem => ({
    prompt: "Ik ____ naar huis.",
    answerSource: "book",
    confidence: 1,
    ...o,
  });
  const vocab = new Set(["fiets", "rood", "lopen"]);
  const isWord = (k: string) => vocab.has(k);
  it("uses the bracketed lemma hint", () => {
    expect(bookItemKeys("gapfill", item({ hint: "(Lopen)", answer: "loop" }), isWord)).toEqual([
      "lopen",
    ]);
  });
  it("falls back to the known words of the answer", () => {
    expect(bookItemKeys("choice", item({ answer: "de rode fiets" }), isWord)).toEqual(["fiets"]);
  });
  it("ignores word-order and open exercises", () => {
    expect(bookItemKeys("sentence-building", item({ answer: "fiets" }), isWord)).toEqual([]);
    expect(bookItemKeys("open-task", item({ hint: "fiets" }), isWord)).toEqual([]);
  });
});
