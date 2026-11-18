/**
 * Server mode request counts (review A8) and cross-device freshness (review A7): the live
 * services run over the real HTTP repository, whose fetch is answered in-process by a local
 * repository through the same RPC allow-list the API service uses.
 */
import { type AnalyzedToken, textDifficulty } from "@app/core";
import {
  type KenningRepository,
  contentHash,
  createRepository,
  encodeRpcResult,
  isRpcMethod,
  validateRpcArgs,
} from "@app/db";
import { createHttpRepository } from "@app/db/http";
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

/** In-process API: /api/info and /api/rpc over `repo`, counting RPCs by method. */
function inProcessServer(repo: KenningRepository) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/api/info")) return Response.json({ deviceId: repo.deviceId });
    const { method, args } = JSON.parse(String(init?.body)) as { method: string; args: unknown[] };
    if (!isRpcMethod(method))
      return Response.json({ ok: false, error: "Unknown method." }, { status: 400 });
    const problem = validateRpcArgs(method, args);
    if (problem) return Response.json({ ok: false, error: problem }, { status: 400 });
    calls.push(method);
    const fn = repo[method] as (...a: unknown[]) => Promise<unknown>;
    const value = encodeRpcResult(await fn.apply(repo, args));
    return Response.json(value === undefined ? { ok: true } : { ok: true, result: value });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

async function seed(): Promise<KenningRepository> {
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

let toClose: KenningRepository | null = null;
afterEach(async () => {
  vi.unstubAllGlobals();
  await toClose?.close();
  toClose = null;
});

async function client(repo: KenningRepository) {
  const server = inProcessServer(repo);
  const http = await createHttpRepository("", undefined, server.fetchImpl);
  const services = createLiveServices(http, { remoteChanged: () => http.remoteChanged() });
  server.calls.length = 0;
  return { server, http, services };
}

describe("server mode request counts (A8)", () => {
  it("Library open, reader page open and practice start use a bounded number of RPCs", async () => {
    vi.stubGlobal("fetch", nlpFetch);
    const repo = (toClose = await seed());
    const counts: Record<string, number> = {};

    let c = await client(repo);
    await Promise.all([c.services.listTexts(), c.services.learnerSummary()]);
    counts["library"] = c.server.calls.length;
    c.server.calls.length = 0;
    await c.services.listTexts();
    counts["libraryAgain"] = c.server.calls.length;

    c = await client(repo);
    const view = await c.services.getReading("t03");
    const idx = view!.plans[0]!.tokens.filter((t) => t.label === "gloss").map((t) => t.i);
    await Promise.all([
      c.services.getSettings(),
      c.services.textGrammar("t03").catch(() => null),
      c.services.learnerSummary(),
      c.services.glosses("t03", idx.length ? idx : [3, 4, 5]),
    ]);
    counts["reader"] = c.server.calls.length;

    c = await client(repo);
    await c.services.practiceOverview();
    await c.services.startPractice({ size: 10 });
    counts["practice"] = c.server.calls.length;

    console.info("[A8] RPCs per screen (cold caches):", JSON.stringify(counts));
    expect(counts["library"]).toBeLessThanOrEqual(8);
    expect(counts["libraryAgain"]).toBe(1);
    expect(counts["reader"]).toBeLessThanOrEqual(10);
    expect(counts["practice"]).toBeLessThanOrEqual(10);
  });
});

describe("batched results equal the per-text results (A8)", () => {
  it("Library coverage equals the reader's plan of each text", async () => {
    vi.stubGlobal("fetch", nlpFetch);
    const repo = (toClose = await seed());
    const list = await (await client(repo)).services.listTexts();
    const single = await client(repo);
    for (const t of list) {
      const v = await single.services.getReading(t.id);
      const d = textDifficulty(v!.plans);
      expect([t.coverage, t.newTypes]).toEqual([d.coverage, d.newTypes]);
    }
  });
});

describe("cross-device freshness (A7)", () => {
  it("sees another client's writes, not its own, and refreshes its caches", async () => {
    vi.stubGlobal("fetch", nlpFetch);
    const repo = (toClose = await seed());
    const laptop = await client(repo);
    const phone = await client(repo);
    const check = () => laptop.services.checkRemoteChanges!();

    expect(await check()).toBe(false);
    expect((await laptop.services.getSettings()).help).toBe(0.25);
    const before = (await laptop.services.words({ keys: ["gracht"] }))[0]!.state;
    const libraryBefore = await laptop.services.listTexts();

    // Own writes do not count as remote changes.
    await laptop.services.saveSettings({ glossClozes: true });
    expect(await check()).toBe(false);

    // The phone changes settings and a word state; the laptop notices on its next check.
    await phone.services.saveSettings({ help: 0.5 });
    await phone.services.setWordState("gracht", "known");
    expect(before).not.toBe("known");
    expect(await check()).toBe(true);
    expect((await laptop.services.getSettings()).help).toBe(0.5);
    expect((await laptop.services.words({ keys: ["gracht"] }))[0]!.state).toBe("known");
    const libraryAfter = await laptop.services.listTexts();
    expect(libraryAfter.map((t) => t.coverage)).not.toEqual(libraryBefore.map((t) => t.coverage));
    // Nothing new since the last check.
    expect(await check()).toBe(false);
  });

  it("is absent in browser mode (no remote source)", async () => {
    const repo = (toClose = await seed());
    expect(createLiveServices(repo).checkRemoteChanges).toBeUndefined();
  });
});

describe("analyzer version (review A4)", () => {
  it("a text analysed by an older analyzer is re-analysed once, in the background", async () => {
    const analyzed: string[][] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const u = String(url);
        if (u.includes("/nlp/health"))
          return Response.json({ status: "ok", version: "x", analyzerVersion: "a1-new" });
        if (u.includes("/nlp/analyze/text")) {
          const texts = (JSON.parse(String(init?.body)) as { texts: string[] }).texts;
          analyzed.push(texts);
          return Response.json(
            texts.map((t) => ({ tokens: tokenize(t), analyzerVersion: "a1-new" })),
          );
        }
        return nlpFetch(url, init);
      }),
    );
    const repo = (toClose = await seed());
    expect((await repo.getText("t03"))?.analyzerVersion).toBeNull();
    const c = await client(repo);
    expect(await c.services.getReading("t03")).not.toBeNull();
    await vi.waitFor(async () => {
      expect((await repo.getText("t03"))?.analyzerVersion).toBe("a1-new");
    });
    await c.services.getReading("t03");
    await c.services.getReading("t03");
    expect(analyzed).toHaveLength(1);
  });
});
