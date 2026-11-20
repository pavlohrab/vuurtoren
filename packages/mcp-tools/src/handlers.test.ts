import { grammarTopics } from "@app/content";
import type { AnalyzedToken } from "@app/core";
import { createRepository, type VuurtorenRepository } from "@app/db";
import { createNodeDriver } from "@app/db/node";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it } from "vitest";
import { createVuurtorenMcpServer, createToolHandlers, MAX_TEXT_CHARS } from "./index.js";

/** One token per letter run; each "." ends a sentence. Lemma = lower-cased word. */
const tokenize = (text: string): Promise<AnalyzedToken[]> => {
  let sent = 0;
  const out: AnalyzedToken[] = [];
  for (const m of text.matchAll(/\p{L}+|\./gu)) {
    if (m[0] === ".") {
      sent++;
      continue;
    }
    out.push({
      i: out.length,
      text: m[0],
      lemma: m[0].toLowerCase(),
      alt_lemmas: [],
      pos: "NOUN",
      morph: "",
      dep: "",
      head: out.length,
      sent,
      start: m.index,
      end: m.index + m[0].length,
      is_word: true,
      is_propn: false,
      is_num: false,
      particle_of: null,
      zipf: 4,
    });
  }
  return Promise.resolve(out);
};

let repo: VuurtorenRepository;

beforeEach(async () => {
  repo = await createRepository(await createNodeDriver());
  await repo.append({
    type: "AnkiSnapshotImported",
    lang: "nl",
    sources: ["d"],
    entries: ["ik", "drink", "koffie", "thee"].map((key, i) => ({
      key,
      state: i === 3 ? ("learning" as const) : ("known" as const),
      pKnown: 0.95,
      noteIds: [i],
      decks: ["d"],
      gloss: `g-${key}`,
    })),
  });
  await repo.append({
    type: "TextImported",
    textId: "t1",
    title: "Koffie",
    lang: "nl",
    source: { kind: "paste" },
    content: "Ik drink koffie.",
  });
});

const handlers = (analyze: typeof tokenize | undefined = tokenize) =>
  createToolHandlers({ repo, analyze, newId: () => "new-text" });

describe("tool handlers", () => {
  it("get_known_words filters by state, prefix and limit", async () => {
    const h = handlers();
    expect((await h.getKnownWords({})).words.map((w) => w.word).sort()).toEqual([
      "drink",
      "ik",
      "koffie",
    ]);
    expect((await h.getKnownWords({ query: "k" })).words).toEqual([
      { word: "koffie", state: "known", gloss: "g-koffie" },
    ]);
    expect((await h.getKnownWords({ state: "learning" })).words[0]?.word).toBe("thee");
    expect((await h.getKnownWords({ limit: 1 })).count).toBe(1);
  });

  it("check_coverage scores text and names unknown words; explains a missing NLP server", async () => {
    const r = await handlers().checkCoverage({ text: "Ik drink koffie en zonnebloem" });
    expect(r.words).toBe(5);
    expect(r.unknownWords).toEqual(["en", "zonnebloem"]);
    expect(r.coverage).toBeCloseTo(0.6, 1);
    await expect(handlers().checkCoverage({ text: "  " })).rejects.toThrow(/empty/);
    const noNlp = createToolHandlers({ repo });
    await expect(noNlp.checkCoverage({ text: "Ik" })).rejects.toThrow(/VUURTOREN_NLP_URL/);
  });

  it("lists and reads texts, truncating long ones", async () => {
    const h = handlers();
    expect(await h.listTexts()).toEqual([{ id: "t1", title: "Koffie", words: 3, source: "paste" }]);
    expect((await h.getText({ id: "t1" })).content).toBe("Ik drink koffie.");
    await expect(h.getText({ id: "nope" })).rejects.toThrow(/No text/);
    await repo.append({
      type: "TextImported",
      textId: "big",
      title: "Big",
      lang: "nl",
      source: { kind: "paste" },
      content: "a ".repeat(MAX_TEXT_CHARS),
    });
    const big = await h.getText({ id: "big" });
    expect(big.truncated).toBe(true);
    expect(big.content).toHaveLength(MAX_TEXT_CHARS);
  });

  it("save_text stores an AI text with claude-code provenance and analyses it", async () => {
    const r = await handlers().saveText({
      title: "Op de fiets",
      content: "Ik drink koffie. Ik fiets.",
      topic: "cycling",
      targets: ["fiets"],
    });
    expect(r).toMatchObject({ textId: "new-text", words: 5 });
    expect(r.coverage).toBeGreaterThan(0.5);
    const t = await repo.getText("new-text");
    expect(t?.sourceKind).toBe("ai");
    expect(t?.analyzed).toBe(true);
    // The analysis is cached, not logged.
    expect((await repo.events()).some((e) => e.event.type === "TextAnalyzed")).toBe(false);
    const ev = (await repo.events()).find(
      (e) => e.event.type === "TextImported" && e.event.textId === "new-text",
    );
    expect(ev?.event).toMatchObject({
      source: { kind: "ai", provider: "claude-code", targets: ["fiets"], topic: "cycling" },
    });
    // Without a language server the text is saved unanalysed (the app analyses it on open).
    const plain = await createToolHandlers({ repo, newId: () => "plain" }).saveText({
      title: "x",
      content: "Ik.",
    });
    expect(plain.coverage).toBeUndefined();
    expect((await repo.getText("plain"))?.analyzed).toBe(false);
    await expect(handlers().saveText({ title: " ", content: "a" })).rejects.toThrow(/title/);
  });

  it("get_words_to_learn returns the reader's to-learn words with a sentence", async () => {
    const h = handlers();
    await h.saveText({ title: "Fiets", content: "Ik drink koffie. Ik fiets naar huis." });
    const r = await h.getWordsToLearn({});
    expect(r.words.length).toBeGreaterThan(0);
    const fiets = r.words.find((w) => w.word === "fiets");
    expect(fiets).toMatchObject({ text: "Fiets", sentence: "Ik fiets naar huis" });
    expect(r.words.some((w) => w.word === "koffie")).toBe(false);
  });

  it("suggest_words_for_anki queues words and skips known, in-Anki and duplicate ones", async () => {
    const h = handlers();
    const r = await h.suggestWordsForAnki({
      words: [
        { word: "de fiets", gloss: "bike", sentence: "Ik fiets." },
        { word: "koffie" },
        { word: "fiets" },
      ],
      note: "cycling story",
    });
    expect(r.queued).toEqual(["de fiets"]);
    expect(r.skipped).toEqual([
      { word: "koffie", reason: "already in Anki" },
      { word: "fiets", reason: "duplicate" },
    ]);
    const open = await repo.suggestedWords("nl");
    expect(open).toMatchObject([
      { key: "fiets", word: "de fiets", gloss: "bike", by: "claude-code", note: "cycling story" },
    ]);
    const again = await h.suggestWordsForAnki({ words: [{ word: "fiets" }] });
    expect(again.skipped[0]?.reason).toBe("already suggested");
    // Nothing reached Anki: no NoteAddedToAnki events.
    expect((await repo.events()).some((e) => e.event.type === "NoteAddedToAnki")).toBe(false);
  });

  it("courses, units and grammar topics", async () => {
    const h = handlers();
    await expect(h.getUnit({ unit: 1 })).rejects.toThrow(/no courses/);
    await repo.append({
      type: "CourseImported",
      course: {
        id: "c1",
        title: "Voorbeeldcursus",
        lang: "nl",
        source: { kind: "pdf" },
        pageCount: 10,
        created: 1,
      },
    });
    await repo.append({
      type: "UnitDefined",
      courseId: "c1",
      units: [
        { courseId: "c1", n: 1, title: "Thema 1", pages: [1, 5], ankiDecks: [], kind: "theme" },
        {
          courseId: "c1",
          n: 2,
          title: "Thema 2 Wonen",
          pages: [6, 10],
          ankiDecks: [],
          kind: "theme",
        },
      ],
    });
    await repo.append({
      type: "BlocksExtracted",
      courseId: "c1",
      blocks: [
        { page: 6, kind: "text", text: "Anne woont in Utrecht. Zij drinkt koffie met haar buren." },
        { page: 7, kind: "grammar", label: "Het perfectum", text: "..." },
      ],
    });
    await repo.append({
      type: "UnitWordsSet",
      courseId: "c1",
      unitN: 2,
      words: [
        { lemma: "koffie", source: "wordlist", gloss: "coffee" },
        { lemma: "huis", article: "het", source: "wordlist" },
      ],
    });
    const topic = grammarTopics("nl")[0]!.id;
    await repo.append({
      type: "BookExerciseExtracted",
      courseId: "c1",
      unitN: 2,
      exercises: [
        {
          number: 1,
          page: 7,
          instruction: "Vul in.",
          type: "gapfill",
          raw: "",
          items: [],
          grammar: topic,
        },
      ],
    });
    expect(await h.listCourses()).toEqual([
      {
        id: "c1",
        title: "Voorbeeldcursus",
        units: [
          { n: 1, title: "Thema 1", kind: "theme" },
          { n: 2, title: "Thema 2 Wonen", kind: "theme" },
        ],
      },
    ]);
    const u = await h.getUnit({ unit: "wonen", includeTexts: true });
    expect(u.unit.n).toBe(2);
    expect(u.words).toEqual([
      { word: "koffie", gloss: "coffee", state: "known" },
      { word: "het huis", state: "unknown" },
    ]);
    expect(u.grammarTopics.map((t) => t.id)).toEqual([topic]);
    expect(u.grammarNotes).toEqual(["Het perfectum"]);
    expect(u.texts[0]?.content).toContain("Anne woont");
    expect((await h.getUnit({ unit: 2, courseId: "Voorbeeld" })).unit.n).toBe(2);
    await expect(h.getUnit({ unit: 9 })).rejects.toThrow(/No unit/);

    const list = await h.getGrammarTopic({});
    expect(list.count).toBeGreaterThan(5);
    const page = await h.getGrammarTopic({ id: topic });
    expect(page).toMatchObject({ id: topic });
    expect(typeof (page as { body: string }).body).toBe("string");
    await expect(h.getGrammarTopic({ id: "nope" })).rejects.toThrow(/No grammar topic/);
  });
});

describe("MCP server", () => {
  it("lists the shared tools and answers over the protocol, errors as isError", async () => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createVuurtorenMcpServer(handlers()).connect(a);
    const client = new Client({ name: "test", version: "0" });
    await client.connect(b);
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual([
      "check_coverage",
      "get_grammar_topic",
      "get_known_words",
      "get_text",
      "get_unit",
      "get_words_to_learn",
      "list_courses",
      "list_texts",
      "save_text",
      "suggest_words_for_anki",
    ]);
    expect(client.getInstructions()).toContain("suggest_words_for_anki");
    const ok = await client.callTool({
      name: "check_coverage",
      arguments: { text: "Ik drink koffie" },
    });
    expect(JSON.stringify(ok.content)).toContain('\\"coverage\\":0.95');
    const bad = await client.callTool({ name: "get_text", arguments: { id: "zzz" } });
    expect(bad.isError).toBe(true);
    await client.close();
  });
});
