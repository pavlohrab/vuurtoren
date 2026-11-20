import type { AnalyzedToken } from "@app/core";
import { type VuurtorenRepository, contentHash, createRepository } from "@app/db";
import { createNodeDriver } from "@app/db/node";
import type { GrammarHit as ServerHit, NlpClient } from "@app/nlp-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chunkText } from "./liveTexts.js";
import { GRAMMAR_VERSION, createLiveGrammar, rebaseHits } from "./liveGrammar.js";

/** Tokenizer like the server's: words and full stops, sentences end at a full stop. */
function tokenize(text: string, base = 0, sentBase = 0, iBase = 0): AnalyzedToken[] {
  const out: AnalyzedToken[] = [];
  let sent = sentBase;
  for (const m of text.matchAll(/\p{L}+|[.]/gu)) {
    const word = m[0] !== ".";
    const i = iBase + out.length;
    out.push({
      i,
      text: m[0],
      lemma: m[0].toLowerCase(),
      alt_lemmas: [],
      pos: word ? "VERB" : "PUNCT",
      morph: "",
      dep: "",
      head: i,
      sent,
      start: base + m.index,
      end: base + m.index + m[0].length,
      is_word: word,
      is_propn: false,
      is_num: false,
      particle_of: null,
      zipf: 4,
    });
    if (!word) sent += 1;
  }
  return out;
}

/** What /grammar says for one chunk: an inversion on the 2nd and 3rd word of each sentence. */
function detect(text: string): ServerHit[] {
  const toks = tokenize(text);
  const hits: ServerHit[] = [];
  for (const sent of new Set(toks.map((t) => t.sent))) {
    const s = toks.filter((t) => t.sent === sent);
    if (s.length < 4) continue;
    hits.push({
      topic: "inversion",
      tokens: [s[1]!.i, s[2]!.i],
      sent,
      sentence: text.slice(s[0]!.start, s[s.length - 1]!.end),
      start: s[0]!.start,
      end: s[s.length - 1]!.end,
      note: `verb «${s[1]!.text}» first`,
    });
  }
  return hits;
}

const TEXT = "Morgen ga ik naar school.\n\nGisteren kocht hij een fiets.";

let repo: VuurtorenRepository;
let grammarCalls: string[][];
let fail: boolean;

const nlp = {
  grammar: vi.fn(async (_lang: string, texts: string[]) => {
    if (fail) throw new Error("NLP service unreachable");
    grammarCalls.push(texts);
    return texts.map(detect);
  }),
  grammarExamples: vi.fn(async (topic: string) => {
    if (fail) throw new Error("NLP service unreachable");
    return topic === "inversion"
      ? [
          {
            text: "Vandaag werkt hij thuis.",
            translation: "Today he works at home.",
            marks: [[8, 13]] as [number, number][],
            note: "verb first",
            source: "tatoeba" as const,
          },
        ]
      : [];
  }),
} as unknown as NlpClient;

async function addText(id: string, content: string) {
  await repo.append({
    type: "TextImported",
    textId: id,
    title: `Text ${id}`,
    lang: "nl",
    source: { kind: "paste" },
    content,
  });
  await repo.append({
    type: "TextAnalyzed",
    textId: id,
    contentHash: contentHash(content),
    tokens: tokenize(content),
  });
}

function grammar(chunk = chunkText) {
  return createLiveGrammar({
    repo,
    nlp: async () => nlp,
    view: async () => null,
    model: async () => new Map(),
    chunkText: chunk,
    translate: async (s) => new Map(s.map((x) => [x, `EN ${x}`])),
  });
}

beforeEach(async () => {
  repo = await createRepository(await createNodeDriver());
  grammarCalls = [];
  fail = false;
  vi.clearAllMocks();
});
afterEach(async () => {
  await repo.close();
});

describe("live grammar", () => {
  it("detects once, stores the hits with the analysis and reuses them", async () => {
    await addText("t1", TEXT);
    const g = grammar();
    const hits = await g.textGrammar("t1");
    expect(hits.map((h) => h.note)).toEqual(["verb «ga» first", "verb «kocht» first"]);
    expect(await repo.textGrammar("t1")).toMatchObject({ version: GRAMMAR_VERSION, hits });
    // A second service instance (a reload) reads the stored hits: no new request.
    expect(await grammar().textGrammar("t1")).toEqual(hits);
    expect(grammarCalls).toHaveLength(1);
    // Hits are stored without the sentence text (it is part of the content).
    expect(Object.keys(hits[0]!)).not.toContain("sentence");
  });

  it("rebases chunked hits onto the whole text", async () => {
    await addText("t1", TEXT);
    // Force two chunks (one per paragraph).
    const hits = await grammar((text) => chunkText(text, 30)).textGrammar("t1");
    expect(grammarCalls[0]).toHaveLength(2);
    const tokens = (await repo.getText("t1"))!.tokens!;
    expect(hits.map((h) => h.tokens.map((i) => tokens[i]!.text))).toEqual([
      ["ga", "ik"],
      ["kocht", "hij"],
    ]);
    expect(hits[1]!.sent).toBe(1);
    expect(TEXT.slice(hits[1]!.start, hits[1]!.end)).toBe("Gisteren kocht hij een fiets.");
  });

  it("drops hits whose tokens do not match the stored analysis", () => {
    const tokens = tokenize("Morgen ga ik.");
    const chunk = [{ start: 0, text: "Morgen ga ik." }];
    const bad = [
      [
        { topic: "x", tokens: [1, 2], sent: 0, start: 0, end: 13, note: "ok" },
        { topic: "x", tokens: [9], sent: 0, start: 0, end: 13, note: "out of range" },
        { topic: "x", tokens: [1], sent: 0, start: 10, end: 13, note: "outside sentence" },
      ],
    ];
    expect(rebaseHits(chunk, bad, tokens).map((h) => h.note)).toEqual(["ok"]);
  });

  it("counts topics over the library and reports texts it could not check", async () => {
    await addText("t1", TEXT);
    await addText("t2", "Daarom blijft zij thuis vandaag.");
    const g = grammar();
    expect(await g.grammarOverview()).toEqual({
      counts: { inversion: 3 },
      textCounts: { inversion: 2 },
      texts: 2,
      missing: 0,
    });
    await addText("t3", "Nu werkt het niet goed.");
    fail = true;
    const o = await g.grammarOverview();
    expect(o.texts).toBe(2);
    expect(o.missing).toBe(1);
  });

  it("gives library examples first, then Tatoeba, and degrades without the server", async () => {
    await addText("t1", TEXT);
    const g = grammar();
    const ex = await g.grammarExamples(["inversion"]);
    expect(ex.library.map((e) => e.sentence)).toEqual([
      "Morgen ga ik naar school.",
      "Gisteren kocht hij een fiets.",
    ]);
    expect(ex.library[0]).toMatchObject({
      textId: "t1",
      title: "Text t1",
      marks: [
        [7, 9],
        [10, 12],
      ],
    });
    expect(ex.tatoeba.map((e) => e.text)).toEqual(["Vandaag werkt hij thuis."]);
    expect(ex.tatoebaUnavailable).toBe(false);

    fail = true;
    const down = await g.grammarExamples(["inversion"]);
    expect(down.library).toHaveLength(2); // stored hits still work
    expect(down.tatoeba).toEqual([]);
    expect(down.tatoebaUnavailable).toBe(true);
  });

  it("collects topic material: hit sentences (translated) and their words", async () => {
    await addText("t1", TEXT);
    const m = await grammar().topicMaterial(["inversion"]);
    expect(m.sentences.map((s) => [s.source, s.text, s.key])).toEqual([
      ["text", "Morgen ga ik naar school.", "ga"],
      ["text", "Gisteren kocht hij een fiets.", "kocht"],
      ["tatoeba", "Vandaag werkt hij thuis.", "werkt"],
    ]);
    expect(m.sentences[0]?.translation).toBe("EN Morgen ga ik naar school.");
    expect(m.words.map((w) => w.lemma)).toEqual(["ga", "ik", "kocht", "hij"]);
    expect(m.words[0]?.sentence).toMatchObject({
      text: "Morgen ga ik naar school.",
      target: [7, 9],
    });
  });
});
