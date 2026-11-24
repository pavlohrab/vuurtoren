import type { AnalyzedToken } from "@app/core";
import { createRepository } from "@app/db";
import { createNodeDriver } from "@app/db/node";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KeyValueStorage } from "@app/ai";
import { createLiveAI } from "./liveAI.js";
import type { Settings } from "./types.js";

const KNOWN = ["ik", "drink", "koffie", "jij", "graag"];

function tokenize(text: string): AnalyzedToken[] {
  return [...text.matchAll(/\p{L}+/gu)].map((m, i) => ({
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
  }));
}

/** One fetch for the NLP server and the provider; the provider answers from a script. */
function stubNetwork(replies: string[]) {
  const providerBodies: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes("/analyze/text")) {
        const { texts } = JSON.parse(init.body as string) as { texts: string[] };
        return new Response(JSON.stringify(texts.map((t) => ({ tokens: tokenize(t) }))));
      }
      providerBodies.push(init.body as string);
      const text = replies.shift() ?? "{}";
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text }],
          usage: { input_tokens: 100, output_tokens: 20 },
        }),
      );
    }),
  );
  return providerBodies;
}

function memStorage(): KeyValueStorage & { all(): string } {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    all: () => JSON.stringify([...m]),
  };
}

async function setup() {
  const repo = await createRepository(await createNodeDriver());
  const storage = memStorage();
  const settings: Settings = {
    ankiUrl: "x",
    nlpUrl: "http://nlp",
    lang: "nl",
    targetDeck: "Deck",
    theme: "system",
    help: 0.25,
    newWords: "auto",
    glossClozes: false,
    grammarMarks: true,
    reviewWeek: [1, 1, 1, 1, 1, 1, 1],
    newWordsPerDay: 10,
    reviewsPerDay: 200,
    voice: "female",
    autoplayWord: true,
    autoplaySentence: false,
    audioRate: 1,
  };
  const ai = createLiveAI({
    repo,
    storage,
    settings: () => Promise.resolve(settings),
    model: () => Promise.resolve(new Map(KNOWN.map((k) => [k, { state: "known", pKnown: 1 }]))),
    vocabEstimate: () => Promise.resolve(500),
    anki: () => Promise.reject(new Error("no anki")),
    glossLemmas: () => Promise.resolve({}),
    changed: () => undefined,
  });
  return { repo, storage, ai };
}

afterEach(() => vi.unstubAllGlobals());

const turn = (reply: string) => JSON.stringify({ reply, corrections: [], new_words: [] });

describe("live AI services", () => {
  it("lists models with the saved key, caches per provider, falls back to curated", async () => {
    const { ai } = await setup();
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        urls.push(url);
        expect(new Headers(init?.headers).get("x-api-key")).toBe("sk-ant-K");
        return new Response(JSON.stringify({ data: [{ id: "claude-sonnet-5-5" }] }));
      }),
    );
    const anth = { provider: "anthropic" as const, baseUrl: "https://api.anthropic.com" };
    // No key yet: curated list, no request.
    expect((await ai.listAIModels(anth)).live).toBe(false);
    expect(urls).toHaveLength(0);
    await ai.saveAIKey("sk-ant-K");
    const live = await ai.listAIModels(anth, "sk-ant-K");
    expect(live.live).toBe(true);
    expect(live.options.map((o) => [o.id, o.recommended ?? false])).toEqual([
      ["claude-haiku-5-5", true],
      ["claude-sonnet-5-5", false],
    ]);
    await ai.listAIModels(anth);
    expect(urls).toHaveLength(1); // cached for the session
  });

  it("refuses to start without a key, and stores the key outside the database", async () => {
    const { repo, storage, ai } = await setup();
    expect((await ai.aiStatus()).configured).toBe(false);
    await expect(ai.startConversation({ topic: "koffie" })).rejects.toThrow(/key/i);
    expect(await repo.conversationEvents()).toHaveLength(0);

    await ai.saveAIKey("sk-ant-SECRET");
    expect((await ai.aiStatus()).configured).toBe(true);
    expect(storage.all()).toContain("sk-ant-SECRET");
    expect(JSON.stringify(await repo.events())).not.toContain("SECRET");
  });

  it("runs a conversation: sends the key header, stores events, rewrites once, survives reload", async () => {
    const bodies = stubNetwork([
      turn("Ik drink koffie"), // opening
      turn("Ik drink zonnebloem"), // too hard
      turn("Jij drink graag koffie"), // the single rewrite
    ]);
    const { repo, ai } = await setup();
    await ai.saveAIKey("sk-x");
    const started = await ai.startConversation({ topic: "koffie", targetWords: ["gezellig"] });
    expect(started.messages).toHaveLength(1);
    expect(started.messages[0]!.coverage).toBe(1);

    const after = await ai.sendConversationMessage(started.id, "Ik is blij");
    expect(bodies).toHaveLength(3); // opening + answer + one rewrite
    const reply = after.messages.at(-1)!;
    expect(after.messages).toHaveLength(3);
    expect(reply.rewritten).toBe(true);
    expect(reply.text).toBe("Jij drink graag koffie");

    // events only: no key anywhere in them, and the list/reload works from the log
    const events = JSON.stringify(await repo.events());
    expect(events).toContain("ConversationStarted");
    expect(events).not.toContain("sk-x");
    expect((await ai.listConversations())[0]!.topic).toBe("koffie");
    expect((await ai.getConversation(started.id))!.messages).toHaveLength(3);
    expect((await ai.aiUsage()).calls).toBe(3);
  });

  it("encrypts with a passphrase and needs unlock after a restart", async () => {
    const { storage, ai } = await setup();
    await ai.saveAIKey("sk-secret", "pass");
    expect(storage.all()).not.toContain("sk-secret");
    // a fresh session has no decrypted key
    const repo2 = await createRepository(await createNodeDriver());
    const ai2 = createLiveAI({
      repo: repo2,
      storage,
      settings: () => Promise.reject(new Error("unused")),
      model: () => Promise.resolve(new Map()),
      vocabEstimate: () => Promise.resolve(0),
      anki: () => Promise.reject(new Error("unused")),
      glossLemmas: () => Promise.resolve({}),
      changed: () => undefined,
    });
    expect((await ai2.aiStatus()).locked).toBe(true);
    await expect(ai2.unlockAI("wrong")).rejects.toThrow(/passphrase/i);
    await ai2.unlockAI("pass");
    expect((await ai2.aiStatus()).configured).toBe(true);
  });

  it("switching provider takes the preset's address and model", async () => {
    const { ai } = await setup();
    await ai.saveAISettings({ provider: "ollama" });
    const s = await ai.getAISettings();
    expect(s.baseUrl).toBe("http://localhost:11434/v1");
    expect((await ai.aiStatus()).configured).toBe(true); // keyless
  });
});

describe("AI stories and sentences (live)", () => {
  it("writes a story, saves it as an AI text with provenance and no key", async () => {
    const bodies = stubNetwork([
      JSON.stringify({
        title: "Koffie",
        text: "Ik drink graag koffie. Jij drink koffie.",
        used_targets: ["graag"],
      }),
    ]);
    const { repo, ai } = await setup();
    await ai.saveAIKey("sk-story");
    const steps: string[] = [];
    const r = await ai.createStory(
      { topic: "koffie", length: "short", style: "story", targetWords: ["graag", " "] },
      (m) => steps.push(m),
    );
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain("Target words: graag");
    expect(r).toMatchObject({ title: "Koffie", coverage: 1, missingTargets: [], rewritten: false });
    const text = await repo.getText(r.textId);
    expect(text).toMatchObject({ title: "Koffie", sourceKind: "ai" });
    const ev = (await repo.events()).find((e) => e.event.type === "TextImported")!.event;
    expect(ev).toMatchObject({
      source: { kind: "ai", provider: "anthropic", targets: ["graag"], topic: "koffie" },
    });
    expect(JSON.stringify(await repo.events())).not.toContain("sk-story");
    expect(steps.at(-1)).toMatch(/Saving/);
  });

  it("suggests story targets from a course unit (words not known yet)", async () => {
    stubNetwork([]);
    const { repo, ai } = await setup();
    await repo.append({
      type: "CourseImported",
      course: {
        id: "c",
        title: "Cursus",
        lang: "nl",
        source: { kind: "pdf", filename: "c.pdf" },
        pageCount: 2,
        created: 1,
      },
    });
    await repo.append({
      type: "UnitDefined",
      courseId: "c",
      units: [
        { courseId: "c", n: 1, title: "Thema 1", pages: [1, 2], ankiDecks: [], kind: "theme" },
      ],
    });
    await repo.append({
      type: "UnitWordsSet",
      courseId: "c",
      unitN: 1,
      words: [
        { lemma: "koffie", source: "wordlist" },
        { lemma: "markt", source: "wordlist" },
      ],
    });
    expect(await ai.storyTargets({ kind: "unit", courseId: "c", unitN: 1 })).toEqual(["markt"]);
    expect(await ai.storyTargets({ kind: "grammar", topicId: "inversion" })).toEqual([]);
  });

  it("fills sentences: validates, stores accepted ones, counts rejected", async () => {
    stubNetwork([
      JSON.stringify({
        sentences: [
          { text: "Ik drink graag koffie", translation: "I like coffee" },
          { text: "Ik drink thee", translation: "too short and no target" },
        ],
      }),
    ]);
    const { repo, ai } = await setup();
    await ai.saveAIKey("sk-x");
    const fill = await ai.fillSentences(
      "nl",
      [{ key: "koffie", lemma: "koffie", existing: [] }],
      ["koffie"],
    );
    expect(fill).toMatchObject({ accepted: 1, rejected: 1, requested: 1 });
    expect(fill.sentences[0]![0]).toMatchObject({
      text: "Ik drink graag koffie",
      target: [15, 21],
    });
    const sets = await repo.generatedSentences("nl");
    expect(sets).toEqual([
      expect.objectContaining({ key: "koffie", rejected: 1, provider: "anthropic" }),
    ]);
  });

  it("reports a provider failure instead of throwing (practice goes on)", async () => {
    stubNetwork([]);
    const { ai } = await setup();
    const fill = await ai.fillSentences(
      "nl",
      [{ key: "koffie", lemma: "koffie", existing: [] }],
      [],
    );
    expect(fill.error).toMatch(/key/i);
    expect(fill.sentences).toEqual([[]]);
  });
});
