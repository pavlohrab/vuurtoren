import type { AnalyzedToken } from "@app/core";
import { type VuurtorenRepository, contentHash, createRepository } from "@app/db";
import { createNodeDriver } from "@app/db/node";
import type { AlignItem, AlignedText, NlpClient, PairItem, PairedText } from "@app/nlp-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLiveDictionary } from "./liveDictionary.js";
import { createLiveExtras } from "./liveExtras.js";
import { createLivePairs, englishTokens } from "./livePairs.js";
import { storyRef } from "./stories.js";
import type { ReadingView } from "./types.js";

const TEXT = "De kat slaapt. Morgen bel ik op.";

function tokenize(): AnalyzedToken[] {
  const out: AnalyzedToken[] = [];
  let sent = 0;
  for (const m of TEXT.matchAll(/\p{L}+|[.]/gu)) {
    const word = m[0] !== ".";
    out.push({
      i: out.length,
      text: m[0],
      lemma: m[0].toLowerCase(),
      alt_lemmas: [],
      pos: word ? "X" : "PUNCT",
      morph: "",
      dep: "",
      head: out.length,
      sent,
      start: m.index,
      end: m.index + m[0].length,
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
const TOKENS = tokenize();

/** The language server: every sentence becomes "EN <n>", each word aligns to "w<start>". */
function fakeServer() {
  const asked = { pairs: 0, align: 0 };
  const client = {
    async pairs(items: PairItem[]): Promise<PairedText[]> {
      asked.pairs++;
      return items.map((it, k) => ({
        text: it.text,
        translation: `EN ${k}`,
        source: "mt",
        english: englishTokens(`EN ${k}`),
        words: [],
        pairs: [{ nl: [0], en: [0], confidence: 0.9 }],
      }));
    },
    async align(items: AlignItem[]): Promise<AlignedText[]> {
      asked.align++;
      return items.map((it, k) => ({
        text: it.text,
        translation: `EN ${k}`,
        words: it.spans.map(([start, end]) => ({ start, end, text: `w${start}`, confidence: 0.9 })),
      }));
    },
  } as unknown as NlpClient;
  return { asked, nlp: async () => client };
}

const down = async (): Promise<NlpClient> => {
  throw new Error("no language server");
};

const open: VuurtorenRepository[] = [];
afterEach(async () => {
  for (const r of open.splice(0)) await r.close().catch(() => undefined);
});

async function repoWithText(): Promise<VuurtorenRepository> {
  const repo = await createRepository(await createNodeDriver(), { deviceId: "pc" });
  open.push(repo);
  await repo.append({
    type: "TextImported",
    textId: "t1",
    title: "Kat",
    lang: "nl",
    source: { kind: "paste" },
    content: TEXT,
  });
  await repo.saveTextAnalysis({
    textId: "t1",
    contentHash: contentHash(TEXT),
    tokens: TOKENS,
    analyzerVersion: "v1",
  });
  return repo;
}

describe("text extras", () => {
  it("are made once per text where there is a language server, with every word's English", async () => {
    const repo = await repoWithText();
    const server = fakeServer();
    const dictionary = createLiveDictionary({ repo, lang: async () => "nl", nlp: server.nlp });
    const extras = createLiveExtras({ repo, nlp: server.nlp, dictionary, pauseMs: 0 });
    extras.fillLater();
    await vi.waitFor(async () => expect((await repo.textExtras("t1"))?.sentences).toHaveLength(2));
    const x = (await repo.textExtras("t1"))!;
    expect(x.analyzerVersion).toBe("v1");
    expect(x.sentences[0]).toEqual({
      sent: 0,
      english: "EN 0",
      pairs: [{ nl: [0], en: [0], confidence: 0.9 }],
      // "De" "kat" "slaapt": tokens 0-2, aligned by their place in the sentence.
      align: [
        [0, "w0", 0.9],
        [1, "w3", 0.9],
        [2, "w7", 0.9],
      ],
    });
    // Nothing more to make: the next run asks nothing.
    const before = { ...server.asked };
    extras.fillLater();
    await new Promise((r) => setTimeout(r, 20));
    expect(server.asked).toEqual(before);
  });

  it("are never made for a bundled story: it brings its own English and pairs", async () => {
    const repo = await repoWithText();
    await repo.append({
      type: "TextImported",
      textId: "s1",
      title: "De koe op de toren",
      lang: "nl",
      source: { kind: "paste", ref: storyRef("de-koe-op-de-toren") },
      content: TEXT,
    });
    await repo.saveTextAnalysis({
      textId: "s1",
      contentHash: contentHash(TEXT),
      tokens: TOKENS,
      analyzerVersion: "v1",
    });
    const server = fakeServer();
    const dictionary = createLiveDictionary({ repo, lang: async () => "nl", nlp: server.nlp });
    const extras = createLiveExtras({ repo, nlp: server.nlp, dictionary, pauseMs: 0 });
    extras.fillLater();
    // The own text gets its extras; the story is passed over, and nothing is asked for it.
    await vi.waitFor(async () => expect(await repo.textExtras("t1")).not.toBeNull());
    await new Promise((r) => setTimeout(r, 20));
    expect(await repo.textExtras("s1")).toBeNull();
    expect(server.asked.pairs).toBe(1);
  });

  it("let a device without a language server read: the word sheet and side by side", async () => {
    const repo = await repoWithText();
    const server = fakeServer();
    await createLiveExtras({
      repo,
      nlp: server.nlp,
      dictionary: { seedSentences: () => undefined },
    }).make("t1");

    // Now as the phone: no server at all.
    const dictionary = createLiveDictionary({ repo, lang: async () => "nl", nlp: down });
    const extras = createLiveExtras({ repo, nlp: down, dictionary });
    const text = (await repo.getText("t1"))!;
    await extras.seed(text, TOKENS);
    expect(
      (await dictionary.translateSentences(["Morgen bel ik op."])).get("Morgen bel ik op."),
    ).toBe("EN 1");
    const word = { sentence: "De kat slaapt.", start: 3, end: 6 };
    expect((await dictionary.alignWords([word])).get(dictionary.alignKey(word))).toMatchObject({
      text: "w3",
      confident: true,
    });

    const view = { text, tokens: TOKENS, plans: [] } as unknown as ReadingView;
    const pairs = createLivePairs({
      view: async () => view,
      nlp: down,
      aiReady: () => false,
      aiTranslate: async () => [],
      textPairs: (v) => extras.pairs(v.text),
    });
    const got = await pairs.sentencePairs("t1", [0, 1]);
    expect(got.map((p) => [p.english, p.source, p.pairs[0]?.nl])).toEqual([
      ["EN 0", "offline", [0]],
      ["EN 1", "offline", [4]],
    ]);
  });

  it("format 2: a word the server had no English for is kept, so the phone doesn't ask again", async () => {
    const repo = await repoWithText();
    const server = fakeServer();
    // The server knows no English for "kat" (start 3).
    const blank = async () => {
      const c = await server.nlp();
      return {
        ...c,
        pairs: c.pairs.bind(c),
        async align(items: AlignItem[]) {
          return (await c.align(items)).map((r) => ({
            ...r,
            words: r.words.map((w) => (w.start === 3 ? { ...w, text: "", confidence: 0 } : w)),
          }));
        },
      } as unknown as NlpClient;
    };
    await createLiveExtras({
      repo,
      nlp: blank,
      dictionary: { seedSentences: () => undefined },
    }).make("t1");
    const x = (await repo.textExtras("t1"))!;
    expect(x.sentences[0]?.align).toContainEqual([1, null, 0]);
    expect(x.mtModel).toBe("opus-mt-nl-en");

    // The phone: a server it must not ask.
    const nlp = vi.fn(down);
    const dictionary = createLiveDictionary({ repo, lang: async () => "nl", nlp });
    await createLiveExtras({ repo, nlp, dictionary }).seed((await repo.getText("t1"))!, TOKENS);
    const kat = { sentence: "De kat slaapt.", start: 3, end: 6 };
    expect((await dictionary.alignWords([kat])).get(dictionary.alignKey(kat))).toBeUndefined();
    expect(nlp).not.toHaveBeenCalled();
  });

  it("format 2: meanings built from parts travel, for the phone's dictionary has none", async () => {
    const repo = await repoWithText();
    const server = fakeServer();
    const built = {
      pos: "NOUN",
      article: "de",
      glosses: ["cat nap"],
      origin: "compound" as const,
      formed: "kat + slaap",
    };
    const withGloss = async () => {
      const c = await server.nlp();
      return {
        pairs: c.pairs.bind(c),
        align: c.align.bind(c),
        // "kat" is in every dictionary; "slaapt" (as a lemma here) only built from its parts.
        async gloss(_lang: string, words: string[]) {
          return Object.fromEntries(
            words.map((w) => [
              w,
              w === "kat"
                ? [{ pos: "NOUN", article: "de", glosses: ["cat"] }]
                : w === "slaapt"
                  ? [built]
                  : [],
            ]),
          );
        },
      } as unknown as NlpClient;
    };
    await createLiveExtras({
      repo,
      nlp: withGloss,
      dictionary: { seedSentences: () => undefined },
    }).make("t1");
    expect((await repo.textExtras("t1"))?.glosses).toEqual({ slaapt: [built] });

    // The phone: no server; the bundle's built meaning answers.
    const dictionary = createLiveDictionary({ repo, lang: async () => "nl", nlp: down });
    await createLiveExtras({ repo, nlp: down, dictionary }).seed(
      (await repo.getText("t1"))!,
      TOKENS,
    );
    const got = await dictionary.lookupGlosses([{ key: "slaapt", lemma: "slaapt", pos: "NOUN" }]);
    expect(got.found.get("slaapt")).toBe("cat nap");
  });

  it("are not used for another analysis of the text", async () => {
    const repo = await repoWithText();
    await createLiveExtras({
      repo,
      nlp: fakeServer().nlp,
      dictionary: { seedSentences: () => undefined },
    }).make("t1");
    // Analysed again by a newer analyzer: the old extras index other tokens.
    await repo.saveTextAnalysis({
      textId: "t1",
      contentHash: contentHash(TEXT),
      tokens: TOKENS,
      analyzerVersion: "v2",
    });
    const extras = createLiveExtras({
      repo,
      nlp: down,
      dictionary: { seedSentences: () => undefined },
    });
    expect((await extras.pairs((await repo.getText("t1"))!)).size).toBe(0);
  });
});
