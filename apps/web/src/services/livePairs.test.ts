import type { AnalyzedToken } from "@app/core";
import type { NlpClient, PairItem, PairedText } from "@app/nlp-client";
import { describe, expect, it, vi } from "vitest";
import { createLivePairs, englishTokens } from "./livePairs.js";
import type { ReadingView } from "./types.js";

const TEXT = "Hallo. Morgen bel ik op.";

function tokens(): AnalyzedToken[] {
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
  out[5]!.particle_of = 3; // op -> bel
  return out;
}

const view = { text: { content: TEXT }, tokens: tokens(), plans: [] } as unknown as ReadingView;

/** /translate/pairs: "bel op" (words 1 and 3 of the sentence) pairs with the 2nd English word. */
function fakeNlp(fail = false) {
  const calls: PairItem[][] = [];
  const client = {
    async pairs(items: PairItem[]): Promise<PairedText[]> {
      calls.push(items);
      if (fail) throw new Error("HTTP 503");
      return items.map((it) => ({
        text: it.text,
        translation: it.translation ?? "Tomorrow I call.",
        source: it.translation ? "given" : "mt",
        english: englishTokens(it.translation ?? "Tomorrow I call."),
        words: [],
        pairs: [{ nl: [1, 3], en: [2], confidence: 0.8 }],
      }));
    },
  } as unknown as NlpClient;
  return { calls, nlp: async () => client };
}

describe("sentencePairs", () => {
  it("sends the sentence's words and separable-verb joins, and maps pairs to token indices", async () => {
    const { calls, nlp } = fakeNlp();
    const pairs = createLivePairs({
      view: async () => view,
      nlp,
      aiReady: () => false,
      aiTranslate: vi.fn(),
    });
    const [s] = await pairs.sentencePairs("t", [1]);
    expect(calls[0]).toEqual([
      {
        text: "Morgen bel ik op.",
        spans: [
          [0, 6],
          [7, 10],
          [11, 13],
          [14, 16],
        ],
        joins: [[3, 1]],
      },
    ]);
    expect(s).toMatchObject({ sent: 1, english: "Tomorrow I call.", source: "offline" });
    expect(s?.pairs[0]?.nl).toEqual([3, 5]); // "bel" and "op" in the whole text
  });

  it("with the AI option sends the provider's English and marks it", async () => {
    const { calls, nlp } = fakeNlp();
    const aiTranslate = vi.fn(async (s: string[]) => s.map(() => "Tomorrow I will call."));
    const pairs = createLivePairs({
      view: async () => view,
      nlp,
      aiReady: () => true,
      aiTranslate,
    });
    const [s] = await pairs.sentencePairs("t", [1], { ai: true });
    expect(calls[0]?.[0]?.translation).toBe("Tomorrow I will call.");
    expect(s).toMatchObject({ english: "Tomorrow I will call.", source: "ai" });
    await pairs.sentencePairs("t", [1], { ai: true });
    expect(aiTranslate).toHaveBeenCalledTimes(1); // one provider call per sentence
  });

  it("keeps the offline English when the provider fails, and AI English without the server", async () => {
    const off = fakeNlp();
    const failing = createLivePairs({
      view: async () => view,
      nlp: off.nlp,
      aiReady: () => true,
      aiTranslate: async () => {
        throw new Error("401");
      },
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const [a] = await failing.sentencePairs("t", [1], { ai: true });
    expect(a).toMatchObject({ english: "Tomorrow I call.", source: "offline" });

    const down = fakeNlp(true);
    const noServer = createLivePairs({
      view: async () => view,
      nlp: down.nlp,
      aiReady: () => true,
      aiTranslate: async (s) => s.map(() => "Tomorrow I will call."),
    });
    const [b] = await noServer.sentencePairs("t", [1], { ai: true });
    expect(b).toMatchObject({
      english: "Tomorrow I will call.",
      source: "ai",
      pairs: [],
      retry: true,
    });
    expect(a?.retry).toBeUndefined();
    expect(b?.englishTokens.map((t) => t.text)).toEqual(["Tomorrow", "I", "will", "call", "."]);
  });

  it("uses a bundled story's English: paired by the server, shown alone without it", async () => {
    const { calls, nlp } = fakeNlp();
    const aiTranslate = vi.fn(async (s: string[]) => s.map(() => "AI English."));
    const storyLines = async () => new Map([[1, "Tomorrow I will ring."]]);
    const pairs = createLivePairs({
      view: async () => view,
      nlp,
      aiReady: () => true,
      aiTranslate,
      storyLines,
    });
    const [hallo, s] = await pairs.sentencePairs("t", [0, 1], { ai: true });
    expect(calls[0]?.[1]?.translation).toBe("Tomorrow I will ring.");
    expect(s).toMatchObject({ english: "Tomorrow I will ring.", source: "story" });
    expect(s?.pairs[0]?.nl).toEqual([3, 5]);
    // Only the sentence without the story's English goes to the provider.
    expect(aiTranslate).toHaveBeenCalledWith(["Hallo."]);
    expect(hallo).toMatchObject({ source: "ai" });

    const down = fakeNlp(true);
    const offline = createLivePairs({
      view: async () => view,
      nlp: down.nlp,
      aiReady: () => false,
      aiTranslate,
      storyLines,
    });
    const [t] = await offline.sentencePairs("t", [1]);
    expect(t).toMatchObject({ english: "Tomorrow I will ring.", source: "story", pairs: [] });
  });

  it("takes a story's precomputed pairs without a request, and asks only for the rest", async () => {
    const { calls, nlp } = fakeNlp();
    const pairs = createLivePairs({
      view: async () => view,
      nlp,
      aiReady: () => false,
      aiTranslate: vi.fn(),
      storyPairs: async () =>
        new Map([
          [1, { english: "Tomorrow I ring.", pairs: [{ nl: [1, 3], en: [2], confidence: 0.9 }] }],
        ]),
    });
    const [hallo, s] = await pairs.sentencePairs("t", [0, 1]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.map((it) => it.text)).toEqual(["Hallo."]);
    expect(hallo).toMatchObject({ sent: 0, source: "offline" });
    // Word indices of the sentence on token indices, like the server's pairs.
    expect(s).toMatchObject({ sent: 1, english: "Tomorrow I ring.", source: "story" });
    expect(s?.pairs).toEqual([{ nl: [3, 5], en: [2], confidence: 0.9 }]);
    expect(s?.englishTokens.map((t) => t.text)).toEqual(["Tomorrow", "I", "ring", "."]);

    // Every sentence precomputed: no request, even with the server down.
    const down = fakeNlp(true);
    const offline = createLivePairs({
      view: async () => view,
      nlp: down.nlp,
      aiReady: () => false,
      aiTranslate: vi.fn(),
      storyPairs: async () => new Map([[1, { english: "Tomorrow I ring.", pairs: [] }]]),
    });
    const [t] = await offline.sentencePairs("t", [1]);
    expect(down.calls).toHaveLength(0);
    expect(t?.retry).toBeUndefined();
  });
});
