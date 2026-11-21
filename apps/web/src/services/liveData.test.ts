/**
 * The live services over a seeded local repository: batched Library results, sync while the
 * app is open, and the analyzer version of cached analyses.
 */
import { type AnalyzedToken, textDifficulty } from "@app/core";
import { type VuurtorenRepository, contentHash, createRepository } from "@app/db";
import { createNodeDriver } from "@app/db/node";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLiveServices } from "./live.js";

const WORDS = [
  "gracht",
  "schuur",
  "brug",
  "tuin",
  "fiets",
  "kaas",
  "molen",
  "dijk",
  "boot",
  "straat",
  "winkel",
  "markt",
];
const KNOWN = ["de", "een", "in", "en", "ik", "zie", "het", "is", "mooi", "huis", "naar", "ga"];

function textOf(n: number): string {
  const w = (k: number) => WORDS[(n + k) % WORDS.length]!;
  return [
    `Ik zie de ${w(0)} in het huis. De ${w(1)} is mooi.`,
    `Ik ga naar de ${w(2)} en de ${w(3)}. Het huis is mooi.`,
    `De ${w(4)} en een ${w(5)} zijn in de ${w(6)}. Ik zie het.`,
  ].join("\n\n");
}

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

/** NLP stand-in: dictionary and translations answer; the practice-data endpoints are empty. */
const nlpFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url);
  const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
  if (u.includes("/nlp/gloss")) {
    const words = body["words"] as string[];
    return Response.json(
      Object.fromEntries(words.map((w) => [w, [{ pos: "noun", glosses: [`${w} (dict)`] }]])),
    );
  }
  if (u.includes("/nlp/translate")) {
    const texts = body["texts"] as string[];
    return Response.json(texts.map((text) => ({ text, translation: `EN ${text}` })));
  }
  return Response.json({});
});

async function seed(): Promise<VuurtorenRepository> {
  const repo = await createRepository(await createNodeDriver());
  for (let n = 0; n < 12; n++) {
    const content = textOf(n);
    const textId = `t${String(n).padStart(2, "0")}`;
    await repo.append({
      type: "TextImported",
      textId,
      title: `Text ${n}`,
      lang: "nl",
      source: { kind: "paste" },
      content,
    });
    await repo.append({
      type: "TextAnalyzed",
      textId,
      contentHash: contentHash(content),
      tokens: tokenize(content),
    });
  }
  await repo.append({
    type: "AnkiSnapshotImported",
    lang: "nl",
    sources: ["Deck"],
    entries: [
      ...KNOWN.map((key) => ({
        key,
        state: "known" as const,
        pKnown: 0.95,
        noteIds: [],
        decks: ["Deck"],
      })),
      ...WORDS.map((key, i) => ({
        key,
        state: "learning" as const,
        pKnown: 0.55 + (i % 4) * 0.1,
        noteIds: [],
        decks: ["Deck"],
        ...(i % 2 === 0 ? { gloss: `${key} (card)` } : {}),
      })),
    ],
  });
  return repo;
}

let toClose: VuurtorenRepository | null = null;
afterEach(async () => {
  vi.unstubAllGlobals();
  await toClose?.close();
  toClose = null;
});

/** A fresh set of services over `repo` (as after a restart of the app). */
function client(repo: VuurtorenRepository) {
  return { services: createLiveServices(repo) };
}

describe("batched results equal the per-text results", () => {
  it("Library coverage equals the reader's plan of each text", async () => {
    vi.stubGlobal("fetch", nlpFetch);
    const repo = (toClose = await seed());
    const lib = client(repo).services;
    // Older texts are planned in the background (in batches too): wait for all of them.
    let list = await lib.listTexts();
    await vi.waitFor(async () => {
      list = await lib.listTexts();
      expect(list.some((t) => t.planning)).toBe(false);
    });
    const single = client(repo);
    for (const t of list) {
      const v = await single.services.getReading(t.id);
      const d = textDifficulty(v!.plans);
      expect([t.coverage, t.newTypes]).toEqual([d.coverage, d.newTypes]);
    }
  });
});

describe("sync while the app is open", () => {
  it("syncs only when sync is set up: without it, nothing changes", async () => {
    const repo = (toClose = await seed());
    const services = createLiveServices(repo);
    expect(await services.autoSync!("timer")).toBe(false);
    expect((await services.syncStatus()).place).toBeNull();
  });
});

describe("analyzer version", () => {
  /** A language server reporting analyzer `version`; `analyzed` collects analysed texts. */
  function analyzerServer(version: string, analyzed: string[][]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const u = String(url);
        if (u.includes("/nlp/health"))
          return Response.json({ status: "ok", version: "x", analyzerVersion: version });
        if (u.includes("/nlp/analyze/text")) {
          const texts = (JSON.parse(String(init?.body)) as { texts: string[] }).texts;
          analyzed.push(texts);
          return Response.json(
            texts.map((t) => ({ tokens: tokenize(t), analyzerVersion: version })),
          );
        }
        return nlpFetch(url, init);
      }),
    );
  }

  it("a text analysed by an older analyzer is re-analysed once, in the background", async () => {
    const analyzed: string[][] = [];
    analyzerServer("a1-new", analyzed);
    const repo = (toClose = await seed());
    const events = await repo.eventCount();
    expect((await repo.getText("t03"))?.analyzerVersion).toBeNull();
    const c = await client(repo);
    expect(await c.services.getReading("t03")).not.toBeNull();
    await vi.waitFor(async () => {
      expect((await repo.getText("t03"))?.analyzerVersion).toBe("a1-new");
    });
    await c.services.getReading("t03");
    await c.services.getReading("t03");
    expect(analyzed).toHaveLength(1);
    // The new analysis is in this device's cache, not in the synced log.
    expect(await repo.eventCount()).toBe(events);
    // A new session with the same analyzer does not analyse again.
    const again = await client(repo);
    await again.services.getReading("t03");
    await new Promise((r) => setTimeout(r, 20));
    expect(analyzed).toHaveLength(1);
  });

  it("a different analysis made after the local analyzer appeared is not redone", async () => {
    const analyzed: string[][] = [];
    analyzerServer("a1-mine", analyzed);
    const repo = (toClose = await seed());
    // This device has known its analyzer for a while; then another device's (older or newer)
    // analysis arrives from an old log: different, but not older than the local analyzer.
    await repo.analyzerSeen("a1-mine");
    await new Promise((r) => setTimeout(r, 5));
    const content = textOf(3);
    await repo.append({
      type: "TextAnalyzed",
      textId: "t03",
      contentHash: contentHash(content),
      tokens: tokenize(content),
      analyzerVersion: "a1-theirs",
    });
    const c = await client(repo);
    expect(await c.services.getReading("t03")).not.toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(analyzed).toHaveLength(0);
    expect((await repo.getText("t03"))?.analyzerVersion).toBe("a1-theirs");
  });
});
