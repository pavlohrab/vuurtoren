import { type AnalyzedToken, defaultProfile, textDifficulty } from "@app/core";
import { type VuurtorenRepository, contentHash, createRepository } from "@app/db";
import { createNodeDriver } from "@app/db/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLiveServices } from "./live.js";
import type { AppServices } from "./types.js";

/** Common words the learner already knows; the rest of the text is new to them. */
const KNOWN = ["de", "een", "in", "en", "ik", "zie", "het", "is", "mooi", "huis"];
const TEXT =
  "Ik zie een gracht in het huis. De schuur is mooi.\n\nDe brug en de tuin zijn mooi. Ik zie de gracht.";

/** Naive tokenizer: one token per word, lemma = lowercased surface, sentences end at a full stop. */
function tokenize(text: string): AnalyzedToken[] {
  const out: AnalyzedToken[] = [];
  let sent = 0;
  for (const m of text.matchAll(/\p{L}+|[.]/gu)) {
    const word = m[0] !== ".";
    const i = out.length;
    out.push({
      i,
      text: m[0],
      lemma: m[0].toLowerCase(),
      alt_lemmas: [],
      pos: word ? "NOUN" : "PUNCT",
      morph: "",
      dep: "",
      head: i,
      sent,
      start: m.index,
      end: m.index + m[0].length,
      is_word: word,
      is_propn: false,
      is_num: false,
      particle_of: null,
      zipf: KNOWN.includes(m[0].toLowerCase()) ? 6 : 3.2,
    });
    if (!word) sent += 1;
  }
  return out;
}

type Handler = (action: string, params: Record<string, unknown>) => unknown;

/**
 * Fake NLP + AnkiConnect behind one fetch. Nothing reaches a real Anki: every request is
 * answered here, and writes are recorded.
 */
function fakeBackend(opts: {
  ankiDown?: boolean;
  notes?: Record<number, { deck: string; type: number; queue: number }>;
  /** Dictionary entries by word, instead of the default "<word> (dictionary)". */
  dict?: Record<string, unknown[]>;
  /** English per Dutch word for /translate/align (confidence 0.9). */
  aligned?: Record<string, string>;
  /** The language server's `/health` OCR flag; a PDF upload then reads as a scan. */
  ocr?: boolean;
}) {
  const calls: string[] = [];
  const glossRequests: string[][] = [];
  const nlpCalls: string[] = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const body = (typeof init?.body === "string" ? JSON.parse(init.body) : {}) as Record<
      string,
      unknown
    >;
    // The reader asks the server's analyzer version once per session.
    if (u.includes("/nlp/health"))
      return Response.json({ status: "ok", version: "test", ocr: opts.ocr ?? true });
    if (u.includes("/nlp/extract/pdf"))
      return Response.json({ text: "", title: "", pages: 1, needs_ocr: true });
    if (u.includes("/nlp/")) nlpCalls.push(u.slice(u.indexOf("/nlp/") + 4));
    if (u.includes("/nlp/translate/align")) {
      const items = body["items"] as { text: string; spans: [number, number][] }[];
      return Response.json(
        items.map(({ text, spans }) => ({
          text,
          translation: `EN: ${text}`,
          words: spans.map(([start, end]) => {
            const english = opts.aligned?.[text.slice(start, end).toLowerCase()] ?? null;
            return { start, end, text: english, confidence: english ? 0.9 : 0 };
          }),
        })),
      );
    }
    if (u.includes("/nlp/translate")) {
      const { texts } = JSON.parse(String(init?.body)) as { texts: string[] };
      return Promise.resolve(
        new Response(JSON.stringify(texts.map((text) => ({ text, translation: `EN: ${text}` })))),
      );
    }
    if (u.includes("/nlp/gloss")) {
      const words = body["words"] as string[];
      glossRequests.push(words);
      const result = Object.fromEntries(
        words.map((w) => [
          w,
          opts.dict?.[w] ?? [{ pos: "noun", glosses: [`${w} (dictionary)`], article: "de" }],
        ]),
      );
      return Response.json(result);
    }
    if (opts.ankiDown) throw new TypeError("connection refused");
    const action = String(body["action"]);
    calls.push(action);
    const params = (body["params"] ?? {}) as Record<string, unknown>;
    const answer: Handler = (a, p) => {
      if (a === "version") return 6;
      if (a === "notesInfo") {
        return (p["notes"] as number[]).map((id) => ({
          noteId: id,
          modelName: "x",
          tags: [],
          fields: {},
          cards: [id * 10],
        }));
      }
      if (a === "cardsInfo") {
        return (p["cards"] as number[]).map((cardId) => {
          const n = opts.notes?.[cardId / 10];
          return {
            cardId,
            note: cardId / 10,
            deckName: n?.deck ?? "Deck",
            modelName: "x",
            interval: 0,
            type: n?.type ?? 0,
            queue: n?.queue ?? 0,
            reps: 0,
            lapses: 0,
          };
        });
      }
      throw new Error(`unexpected AnkiConnect action ${a}`);
    };
    return Response.json({ result: answer(action, params), error: null });
  });
  return { fetchFn, calls, glossRequests, nlpCalls };
}

async function setup(
  backend: ReturnType<typeof fakeBackend>,
  known: string[] = KNOWN,
  ankiNotes: { key: string; noteIds: number[]; state?: "learning" | "unknown" }[] = [],
): Promise<{ repo: VuurtorenRepository; services: AppServices; textId: string }> {
  vi.stubGlobal("fetch", backend.fetchFn);
  const repo = await createRepository(await createNodeDriver());
  const tokens = tokenize(TEXT);
  await repo.append({
    type: "TextImported",
    textId: "t1",
    title: "Gracht",
    lang: "nl",
    source: { kind: "paste" },
    content: TEXT,
  });
  await repo.append({
    type: "TextAnalyzed",
    textId: "t1",
    contentHash: contentHash(TEXT),
    tokens,
  });
  await repo.append({
    type: "AnkiSnapshotImported",
    lang: "nl",
    sources: ["Deck"],
    entries: [
      ...known.map((key) => ({
        key,
        state: "known" as const,
        pKnown: 0.95,
        noteIds: [],
        decks: ["Deck"],
      })),
      ...ankiNotes.map((n) => ({
        key: n.key,
        state: n.state ?? ("unknown" as const),
        pKnown: 0,
        noteIds: n.noteIds,
        decks: ["Deck"],
      })),
    ],
  });
  return { repo, services: createLiveServices(repo), textId: "t1" };
}

let repoToClose: VuurtorenRepository | null = null;
beforeEach(() => {
  repoToClose = null;
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await repoToClose?.close();
});

/** Anki notes: gracht = new card, schuur = suspended, tuin = studied (review). */
const NOTES = {
  7: { deck: "Deck", type: 0, queue: 0 },
  8: { deck: "Deck", type: 0, queue: -1 },
  9: { deck: "Deck", type: 2, queue: 2 },
};
const ANKI_WORDS = [
  { key: "gracht", noteIds: [7] },
  { key: "schuur", noteIds: [8] },
  { key: "tuin", noteIds: [9], state: "learning" as const },
];

describe("live textWords", () => {
  it("lists introduce words in text order, with sentence, meaning and article", async () => {
    const backend = fakeBackend({});
    const { repo, services, textId } = await setup(backend);
    repoToClose = repo;
    await services.getReading(textId); // planning asks the dictionary about blanks
    backend.glossRequests.length = 0;

    const words = await services.textWords(textId);
    // gracht occurs twice but is listed once, at its first occurrence
    expect(words.map((w) => w.key)).toEqual(["gracht", "schuur", "brug", "tuin", "zijn"]);
    const first = words[0]!;
    expect(first.source).toBe("introduce");
    expect(first.glosses[0]).toBe("gracht (dictionary)");
    expect(first.article).toBe("de");
    expect(first.entry.sentenceTranslation).toBe(`EN: ${first.sentence}`);
    expect(first.sentence).toBe("Ik zie een gracht in het huis.");
    const [from, to] = first.sentenceHighlight;
    expect(first.sentence.slice(from, to)).toBe("gracht");
    expect(first.entry.key).toBe("gracht");
    expect(first.tokenIndex).toBe(3);
    // nothing in Anki: every word is "absent"; Anki is only probed once
    expect(words.every((w) => w.entry.anki.status === "absent")).toBe(true);
    expect(backend.calls).toEqual(["version"]);
    // one batched dictionary request for all words
    expect(backend.glossRequests).toHaveLength(1);
    expect(backend.glossRequests[0]).toEqual(["gracht", "schuur", "brug", "tuin", "zijn"]);
  });

  it("lists the text's new words once; looked-up ones are marked, studied ones left out", async () => {
    const backend = fakeBackend({ notes: NOTES });
    const { repo, services, textId } = await setup(backend, KNOWN, ANKI_WORDS);
    repoToClose = repo;
    await services.recordLookup(textId, "zijn"); // new, not highlighted: "lookup"
    await services.recordLookup(textId, "tuin"); // being learned: not a new word of the text
    await services.recordLookup(textId, "huis"); // known: never listed
    await services.recordLookup(textId, "brug"); // already highlighted: stays "introduce"

    const words = await services.textWords(textId);
    expect(words.map((w) => [w.key, w.source])).toEqual([
      ["gracht", "introduce"],
      ["schuur", "introduce"],
      ["brug", "introduce"],
      ["zijn", "lookup"],
    ]);
  });

  it("gives every screen the same numbers: coverage, pages and new words", async () => {
    const backend = fakeBackend({ notes: NOTES });
    const { repo, services, textId } = await setup(backend, KNOWN, ANKI_WORDS);
    repoToClose = repo;
    const [item] = await services.listTexts();
    const view = (await services.getReading(textId))!;
    const words = await services.textWords(textId);
    // Library and Home read listTexts; the reader bar and footer read the reading view.
    expect(item!.coverage).toBe(textDifficulty(view.plans).coverage);
    expect(item!.pages).toBe(view.plans.length);
    // "N new" is the number of words listed after reading.
    expect(item!.newTypes).toBe(words.length);
  });

  it("lists titles at once, plans the first texts, and the rest in the background", async () => {
    const backend = fakeBackend({ notes: NOTES });
    const { repo, services } = await setup(backend, KNOWN, ANKI_WORDS);
    repoToClose = repo;
    for (let i = 2; i <= 12; i++) {
      await repo.append({
        type: "TextImported",
        textId: `t${i}`,
        title: `Tekst ${i}`,
        lang: "nl",
        source: { kind: "paste" },
        content: TEXT,
      });
      await repo.append({
        type: "TextAnalyzed",
        textId: `t${i}`,
        contentHash: contentHash(TEXT),
        tokens: tokenize(TEXT),
      });
    }
    const first = await services.listTexts();
    expect(first).toHaveLength(12);
    const planned = first.filter((t) => t.pages !== null);
    expect(planned).toHaveLength(8);
    expect(first.filter((t) => t.planning)).toHaveLength(4);
    // Every title is there either way; the others follow without asking for them.
    await vi.waitFor(async () =>
      expect((await services.listTexts()).every((t) => t.pages !== null && !t.planning)).toBe(true),
    );
  });

  it("lets reader cloze answers teach the learner model", async () => {
    const backend = fakeBackend({ notes: NOTES });
    const { repo, services, textId } = await setup(backend, KNOWN, ANKI_WORDS);
    repoToClose = repo;
    const before = (await services.textWords(textId)).find((x) => x.key === "gracht")!;
    for (let i = 0; i < 3; i++) await services.recordClozeAnswer("gracht", true, false);
    const [w] = await services.words({ query: "gracht" });
    expect(w).toMatchObject({ key: "gracht", state: "learning", appLearning: true });
    const entry = await services.inspect(textId, before.entry.tokenIndex);
    expect(entry).toMatchObject({ key: "gracht", appLearning: true });
  });

  it("reads the Anki state of all rows with one request", async () => {
    const backend = fakeBackend({ notes: NOTES });
    const { repo, services, textId } = await setup(backend, KNOWN, ANKI_WORDS);
    repoToClose = repo;
    await services.recordLookup(textId, "tuin");
    const words = await services.textWords(textId);
    const status = Object.fromEntries(words.map((w) => [w.key, w.entry.anki.status]));
    expect(status).toEqual({
      gracht: "new",
      schuur: "suspended",
      brug: "absent",
      zijn: "absent",
    });
    expect(words[0]?.entry.anki.cardIds).toEqual([70]);
    expect(backend.calls.filter((c) => c === "notesInfo")).toHaveLength(1);
    expect(backend.calls.filter((c) => c === "cardsInfo")).toHaveLength(1);
  });

  it("marks every row unavailable, with the reason, when Anki cannot be reached", async () => {
    const backend = fakeBackend({ ankiDown: true });
    const { repo, services, textId } = await setup(backend);
    repoToClose = repo;
    const words = await services.textWords(textId);
    expect(words).toHaveLength(5);
    for (const w of words) {
      expect(w.entry.anki.status).toBe("unavailable");
      expect(w.entry.anki.detail).toMatch(/cannot reach/);
    }
  });

  it("is empty when everything is known", async () => {
    const backend = fakeBackend({});
    const all = [...new Set(tokenize(TEXT).map((t) => t.lemma))];
    const { repo, services, textId } = await setup(backend, all);
    repoToClose = repo;
    expect(await services.textWords(textId)).toEqual([]);
  });

  it("rejects an unknown text", async () => {
    const backend = fakeBackend({});
    const { repo, services } = await setup(backend);
    repoToClose = repo;
    await expect(services.textWords("nope")).rejects.toThrow(/not found/);
  });
});

describe("live cloze for beginners", () => {
  // Sentence 1 has one word of the 1000 most common ("water", rank 254); the others are rarer.
  const CLOZE_TEXT =
    "Ik zie een gracht. Gracht schuur brug tuin kat water fiets. Brug tuin kat schuur fiets gracht.";

  async function clozeSetup(starterFrom?: number) {
    const backend = fakeBackend({});
    const { repo, services } = await setup(backend, []);
    repoToClose = repo;
    await repo.append({
      type: "LanguageProfileSet",
      profile: { ...defaultProfile("nl"), ...(starterFrom ? { starterFrom } : {}) },
    });
    await repo.append({
      type: "TextImported",
      textId: "t2",
      title: "Woorden",
      lang: "nl",
      source: { kind: "paste" },
      content: CLOZE_TEXT,
    });
    await repo.append({
      type: "TextAnalyzed",
      textId: "t2",
      contentHash: contentHash(CLOZE_TEXT),
      tokens: tokenize(CLOZE_TEXT),
    });
    // No new words highlighted: the only change left to see is the blanks.
    await services.saveSettings({ newWords: 0 });
    const clozeKeys = async () => {
      const view = (await services.getReading("t2"))!;
      return view.plans.flatMap((p) => p.clozes).map((i) => view.tokens[i]!.lemma);
    };
    return { services, clozeKeys };
  }

  it("blanks starter words below the start level without evidence", async () => {
    const { services, clozeKeys } = await clozeSetup(3);
    expect(await clozeKeys()).toEqual(["water"]);
    // only the blanks: the word is still new, nothing is recorded
    expect(await services.words({ query: "water" })).toEqual([]);
  });

  it("leaves learners who start at level 1 as they were", async () => {
    expect(await (await clozeSetup()).clozeKeys()).toEqual([]);
    expect(await (await clozeSetup(1)).clozeKeys()).toEqual([]);
  });

  it("does not blank a word the learner set back to new or ignored", async () => {
    const reset = await clozeSetup(3);
    await reset.services.setWordState("water", "unknown");
    expect(await reset.clozeKeys()).toEqual([]);
    const ignored = await clozeSetup(3);
    await ignored.services.setWordState("water", "ignored");
    expect(await ignored.clozeKeys()).toEqual([]);
  });
});

describe("live text import", () => {
  it("explains that a scanned PDF needs text recognition the server does not have", async () => {
    const { repo, services } = await setup(fakeBackend({ ocr: false }));
    repoToClose = repo;
    const file = new File(["%PDF"], "scan.pdf", { type: "application/pdf" });
    await expect(services.importText({ kind: "pdf", file })).rejects.toThrow(
      /needs text recognition/,
    );
    expect(await services.ocrAvailable()).toBe(false);
  });
});

describe("live word meanings", () => {
  // schuur: a derivation guess; brug: unknown to the dictionary; tuin: a dictionary word.
  const dict = {
    schuur: [
      {
        pos: "noun",
        article: "de",
        glosses: ["scourer"],
        origin: "derivation",
        formed: "schuren + -er",
      },
    ],
    brug: [],
  };
  const aligned = { schuur: "barn", brug: "bridge", tuin: "garden" };
  const tokenOf = (text: string) => tokenize(TEXT).find((t) => t.text === text)!.i;

  it("notes a meaning built from the word's parts and adds the meaning in the sentence", async () => {
    const backend = fakeBackend({ dict, aligned });
    const { repo, services, textId } = await setup(backend);
    repoToClose = repo;
    const entry = await services.inspect(textId, tokenOf("schuur"));
    expect(entry.glosses).toEqual(["scourer"]);
    expect(entry.glossNote).toBe("from schuren + -er");
    expect(entry.sentenceGloss).toBe("barn");
    // the alignment request also brought the sentence translation: no second request
    expect(entry.sentenceTranslation).toBe("EN: De schuur is mooi.");
    expect(backend.nlpCalls.filter((c) => c === "/translate")).toHaveLength(0);
  });

  it("puts a confident meaning in the sentence above a compound guess", async () => {
    const compound = {
      gracht: [
        {
          pos: "noun",
          article: "de",
          glosses: ["grace slot"],
          compound: true,
          origin: "compound",
          formed: "gra + cht",
        },
      ],
    };
    const backend = fakeBackend({ dict: { ...dict, ...compound }, aligned: { gracht: "canal" } });
    const { repo, services, textId } = await setup(backend);
    repoToClose = repo;
    const entry = await services.inspect(textId, tokenOf("gracht"));
    expect(entry.glosses).toEqual(["canal", "grace slot"]);
    expect(entry.glossNote).toBe("in this sentence");
    const inline = await services.glosses(textId, [tokenOf("gracht")]);
    expect(inline[tokenOf("gracht")]).toEqual({ text: "canal", note: "in this sentence" });
  });

  it("uses the meaning in the sentence when the dictionary has nothing", async () => {
    const backend = fakeBackend({ dict, aligned });
    const { repo, services, textId } = await setup(backend);
    repoToClose = repo;
    const entry = await services.inspect(textId, tokenOf("brug"));
    expect(entry.glosses).toEqual(["bridge"]);
    expect(entry.glossNote).toBe("in this sentence");
    expect(entry.sentenceGloss).toBeUndefined();
  });

  it("does not align words the dictionary knows", async () => {
    const backend = fakeBackend({ dict, aligned });
    const { repo, services, textId } = await setup(backend);
    repoToClose = repo;
    const entry = await services.inspect(textId, tokenOf("tuin"));
    expect(entry.glosses).toEqual(["tuin (dictionary)"]);
    expect(entry.glossNote).toBeUndefined();
    expect(backend.nlpCalls).not.toContain("/translate/align");
  });

  it("gives inline glosses with a note for guesses", async () => {
    const backend = fakeBackend({ dict, aligned });
    const { repo, services, textId } = await setup(backend);
    repoToClose = repo;
    const idx = ["schuur", "brug", "tuin"].map(tokenOf);
    const glosses = await services.glosses(textId, idx);
    expect(glosses[idx[0]!]).toEqual({ text: "scourer", note: "from schuren + -er" });
    expect(glosses[idx[1]!]).toEqual({ text: "bridge", note: "in this sentence" });
    expect(glosses[idx[2]!]).toEqual({ text: "tuin" });
  });
});

describe("live audio", () => {
  it("keeps the voice settings and fetches clips in that voice, a missing one once", async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const u = String(url);
        asked.push(u);
        return u.endsWith("/audio/male/word-7f3acd97cd7cde99.mp3")
          ? new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } })
          : Response.json({ detail: "No such clip." }, { status: 404 });
      }),
    );
    const repo = await createRepository(await createNodeDriver());
    repoToClose = repo;
    const first = createLiveServices(repo);
    expect(await first.getSettings()).toMatchObject({
      voice: "female",
      autoplayWord: true,
      autoplaySentence: false,
      audioRate: 1,
    });
    await first.saveSettings({ voice: "male", audioRate: 0.8, autoplaySentence: true });
    // Read back from the event log, as after a reload.
    const services = createLiveServices(repo);
    expect(await services.getSettings()).toMatchObject({
      voice: "male",
      audioRate: 0.8,
      autoplaySentence: true,
    });
    const clip = await services.audioClip("word-7f3acd97cd7cde99");
    expect(clip?.size).toBe(3);
    expect(await services.audioClip("sentence-0000000000000000")).toBeNull();
    expect(await services.audioClip("sentence-0000000000000000")).toBeNull();
    expect(asked.filter((u) => u.includes("sentence-")).length).toBe(1);
    expect(asked.some((u) => u.includes("/audio/female/"))).toBe(false);
  });
});
