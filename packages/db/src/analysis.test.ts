import type { AnalyzedToken } from "@app/core";
import { afterEach, describe, expect, it } from "vitest";
import { contentHash } from "./hash.js";
import { createNodeDriver } from "./node.js";
import { createRepository, type VuurtorenRepository } from "./repository.js";
import { validateRpcArgs } from "./rpc.js";
import type { AppEvent } from "./types.js";

const open: VuurtorenRepository[] = [];
afterEach(async () => {
  for (const r of open.splice(0)) await r.close().catch(() => undefined);
});

async function newRepo(clock = { t: 1_000_000 }): Promise<VuurtorenRepository> {
  const repo = await createRepository(await createNodeDriver(), {
    deviceId: "dev1",
    now: () => clock.t++,
  });
  open.push(repo);
  return repo;
}

const tok = (i: number, lemma: string): AnalyzedToken =>
  ({ i, text: lemma, lemma, is_word: true }) as unknown as AnalyzedToken;

const CONTENT = "De kat slaapt.";
const HASH = contentHash(CONTENT);
const imported: AppEvent = {
  type: "TextImported",
  textId: "t1",
  title: "Kat",
  lang: "nl",
  source: { kind: "paste" },
  content: CONTENT,
};
const hits = [{ topic: "inversion", tokens: [0], sent: 0, start: 0, end: 2, note: "" }];

describe("analysis cache", () => {
  it("TextAnalyzed and TextGrammarDetected from old logs still give tokens and hits", async () => {
    const repo = await newRepo();
    await repo.append(imported);
    await repo.append({
      type: "TextAnalyzed",
      textId: "t1",
      contentHash: HASH,
      tokens: [tok(0, "kat")],
      analyzerVersion: "a1-old",
    });
    await repo.append({
      type: "TextGrammarDetected",
      textId: "t1",
      contentHash: HASH,
      version: 1,
      hits,
    });
    const t = await repo.getText("t1");
    expect(t?.tokens?.map((x) => x.lemma)).toEqual(["kat"]);
    expect(t?.analyzerVersion).toBe("a1-old");
    expect((await repo.listTexts())[0]?.analyzed).toBe(true);
    expect((await repo.textGrammar("t1"))?.hits).toEqual(hits);
    await repo.rebuild();
    expect((await repo.getText("t1"))?.tokens?.map((x) => x.lemma)).toEqual(["kat"]);
    expect((await repo.textGrammar("t1"))?.hits).toEqual(hits);
  });

  it("a new analysis and its grammar hits are cached without an event", async () => {
    const repo = await newRepo();
    await repo.append(imported);
    const before = await repo.eventCount();
    expect(
      await repo.saveTextAnalysis({
        textId: "t1",
        contentHash: HASH,
        tokens: [tok(0, "kat"), tok(1, "slapen")],
        analyzerVersion: "a1-new",
      }),
    ).toBe(true);
    expect(await repo.saveTextGrammar({ textId: "t1", contentHash: HASH, version: 1, hits })).toBe(
      true,
    );
    expect(await repo.eventCount()).toBe(before);
    expect((await repo.events()).map((e) => e.event.type)).toEqual(["TextImported"]);
    const t = await repo.getText("t1");
    expect(t?.tokens?.map((x) => x.lemma)).toEqual(["kat", "slapen"]);
    expect(t?.analyzerVersion).toBe("a1-new");
    expect(t?.analyzedAt).toBeGreaterThan(0);
    // A rebuild keeps the cache (it is not a projection of the log).
    await repo.rebuild();
    expect((await repo.getText("t1"))?.tokens?.map((x) => x.lemma)).toEqual(["kat", "slapen"]);
    expect((await repo.textGrammar("t1"))?.hits).toEqual(hits);
    // Stale content or an unknown text: nothing stored.
    expect(
      await repo.saveTextAnalysis({ textId: "t1", contentHash: "other", tokens: [tok(0, "x")] }),
    ).toBe(false);
    expect(
      await repo.saveTextAnalysis({ textId: "nope", contentHash: HASH, tokens: [tok(0, "x")] }),
    ).toBe(false);
    // Deleting the text clears its cache.
    await repo.append({ type: "TextDeleted", textId: "t1" });
    expect(await repo.textGrammar("t1")).toBeNull();
  });

  it("an old TextAnalyzed event replayed later never overwrites a newer local analysis", async () => {
    const clock = { t: 1_000_000 };
    const repo = await newRepo(clock);
    await repo.append(imported);
    await repo.append({
      type: "TextAnalyzed",
      textId: "t1",
      contentHash: HASH,
      tokens: [tok(0, "old")],
      analyzerVersion: "a1-old",
    });
    await repo.saveTextAnalysis({
      textId: "t1",
      contentHash: HASH,
      tokens: [tok(0, "new")],
      analyzerVersion: "a1-new",
    });
    await repo.saveTextGrammar({ textId: "t1", contentHash: HASH, version: 1, hits });
    await repo.rebuild();
    const t = await repo.getText("t1");
    expect(t?.tokens?.map((x) => x.lemma)).toEqual(["new"]);
    expect(t?.analyzerVersion).toBe("a1-new");
    expect((await repo.textGrammar("t1"))?.hits).toEqual(hits);
  });

  it("a new analyzer version drops the grammar hits of the old tokens", async () => {
    const repo = await newRepo();
    await repo.append(imported);
    await repo.saveTextAnalysis({
      textId: "t1",
      contentHash: HASH,
      tokens: [tok(0, "kat")],
      analyzerVersion: "a1-old",
    });
    await repo.saveTextGrammar({ textId: "t1", contentHash: HASH, version: 1, hits });
    await repo.saveTextAnalysis({
      textId: "t1",
      contentHash: HASH,
      tokens: [tok(0, "kat")],
      analyzerVersion: "a1-new",
    });
    expect(await repo.textGrammar("t1")).toBeNull();
  });

  it("analyzerSeen records when an analyzer version first appeared", async () => {
    const clock = { t: 5_000 };
    const repo = await newRepo(clock);
    const first = await repo.analyzerSeen("a1-x");
    clock.t += 1000;
    expect(await repo.analyzerSeen("a1-x")).toBe(first);
    expect(await repo.analyzerSeen("a1-y")).toBeGreaterThan(first);
  });

  it("the cache methods are callable over RPC with checked arguments", () => {
    expect(
      validateRpcArgs("saveTextAnalysis", [{ textId: "t", contentHash: "h", tokens: [] }]),
    ).toBeNull();
    expect(validateRpcArgs("saveTextAnalysis", [{ textId: "t", tokens: [] }])).toMatch(/required/);
    expect(validateRpcArgs("saveTextAnalysis", [{ textId: "t", contentHash: "h" }])).toMatch(
      /array/,
    );
    expect(
      validateRpcArgs("saveTextGrammar", [{ textId: "t", contentHash: "h", version: 1, hits: [] }]),
    ).toBeNull();
    expect(
      validateRpcArgs("saveTextGrammar", [{ textId: "t", contentHash: "h", hits: [] }]),
    ).toMatch(/version/);
    expect(validateRpcArgs("analyzerSeen", ["a1-x"])).toBeNull();
  });
});
