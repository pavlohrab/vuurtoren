import { AnkiConnectClient } from "@app/anki";
import { type AnalyzedToken, defaultProfile } from "@app/core";
import { createRepository, type KenningRepository } from "@app/db";
import { createNodeDriver } from "@app/db/node";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it } from "vitest";
import { createHandlers, MAX_TEXT_CHARS } from "./handlers.js";
import { buildServer } from "./server.js";

const tokenize = (text: string): Promise<AnalyzedToken[]> =>
  Promise.resolve(
    [...text.matchAll(/\p{L}+/gu)].map((m, i) => ({
      i,
      text: m[0],
      lemma: m[0].toLowerCase(),
      alt_lemmas: [],
      pos: "NOUN",
      morph: "",
      dep: "",
      head: i,
      sent: 0,
      start: m.index,
      end: m.index + m[0].length,
      is_word: true,
      is_propn: false,
      is_num: false,
      particle_of: null,
      zipf: 4,
    })),
  );

let repo: KenningRepository;
const notes: { deck: string; fields: Record<string, string>; tags: string[] }[] = [];
const decks: string[] = [];

/** AnkiConnect fake for the add path: note type, deck and note creation are recorded. */
const anki = new AnkiConnectClient({
  fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
    const { action, params } = JSON.parse(String(init?.body)) as {
      action: string;
      params: Record<string, unknown>;
    };
    let result: unknown = null;
    if (action === "modelNames") result = [];
    if (action === "createDeck") decks.push(String(params["deck"]));
    if (action === "addNote") {
      const n = params["note"] as {
        deckName: string;
        fields: Record<string, string>;
        tags: string[];
      };
      notes.push({ deck: n.deckName, fields: n.fields, tags: n.tags });
      result = 42;
    }
    return new Response(JSON.stringify({ result, error: null }));
  }) as typeof fetch,
});

beforeEach(async () => {
  notes.length = 0;
  decks.length = 0;
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

const handlers = (deck?: string) => createHandlers({ repo, analyze: tokenize, anki, deck });

describe("handlers", () => {
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

  it("check_coverage scores text and names unknown words", async () => {
    const r = await handlers().checkCoverage({ text: "Ik drink koffie en zonnebloem" });
    expect(r.words).toBe(5);
    expect(r.unknownWords).toEqual(["en", "zonnebloem"]);
    expect(r.coverage).toBeCloseTo(0.6, 1);
    await expect(handlers().checkCoverage({ text: "  " })).rejects.toThrow(/empty/);
  });

  it("lists and reads texts, truncating long ones", async () => {
    const h = handlers();
    expect(await h.listTexts()).toEqual([{ id: "t1", title: "Koffie", words: 3 }]);
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

  it("add_to_anki uses the language profile's deck and the shared key rule", async () => {
    await repo.append({
      type: "LanguageProfileSet",
      profile: {
        ...defaultProfile("nl"),
        destinations: { default: "Kenning::Nederlands", mcp: "Kenning::Nederlands::Claude" },
      },
    });
    const r = await handlers().addToAnki({
      word: "de Fiets",
      gloss: "bike",
      sentence: "De <b>fiets</b> is <i>rood</i>.",
    });
    expect(r).toEqual({ noteId: 42, deck: "Kenning::Nederlands::Claude" });
    expect(decks).toEqual(["Kenning::Nederlands::Claude"]);
    expect(notes[0]?.fields["Word"]).toBe("de Fiets");
    expect(notes[0]?.fields["Sentence"]).toBe("De <b>fiets</b> is &lt;i>rood&lt;/i>.");
    expect(notes[0]?.tags).toEqual(["kenning", "nl", "kenning::from::mcp"]);
    expect((await repo.word("nl", "fiets"))?.addedNoteId).toBe(42);
  });

  it("add_to_anki: default deck without a profile, KENNING_DECK overrides", async () => {
    expect(await handlers().addToAnki({ word: "Gezellig", gloss: "", sentence: "" })).toEqual({
      noteId: 42,
      deck: "Kenning::Nederlands",
    });
    expect((await repo.word("nl", "gezellig"))?.addedNoteId).toBe(42);
    const o = await handlers("Mine").addToAnki({ word: "thee", gloss: "tea", sentence: "" });
    expect(o.deck).toBe("Mine");
    await expect(handlers().addToAnki({ word: " ", gloss: "", sentence: "" })).rejects.toThrow(
      /empty/,
    );
  });
});

describe("MCP server", () => {
  it("lists the five tools and answers calls over the protocol, errors as isError", async () => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await buildServer(handlers()).connect(a);
    const client = new Client({ name: "test", version: "0" });
    await client.connect(b);
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual([
      "add_to_anki",
      "check_coverage",
      "get_known_words",
      "get_text",
      "list_texts",
    ]);

    const ok = await client.callTool({
      name: "check_coverage",
      arguments: { text: "Ik drink koffie" },
    });
    expect(JSON.stringify(ok.content)).toContain('\\"coverage\\": 0.95');

    const bad = await client.callTool({ name: "get_text", arguments: { id: "zzz" } });
    expect(bad.isError).toBe(true);
    await client.close();
  });
});

describe("headwordKey", () => {
  it("strips articles and reflexives and normalises", async () => {
    const { headwordKey } = await import("./handlers.js");
    expect(headwordKey("de fiets")).toBe("fiets");
    expect(headwordKey("Het Huis")).toBe("huis");
    expect(headwordKey("zich vergissen")).toBe("vergissen");
  });
});
