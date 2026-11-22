/** Text bundles: a text analysed on one device reads on another that has no language server. */
import type { AnalyzedToken } from "@app/core";
import { describe, expect, it } from "vitest";
import { contentHash } from "../hash.js";
import { createNodeDriver } from "../node.js";
import { createRepository } from "../repository.js";
import { LIGHT_ARGON2, memoryStore } from "../testing.js";
import { openVault, syncOnce } from "./engine.js";

const T0 = Date.UTC(2026, 10, 22, 12);
const PASS = "lange zinnen lezen";
const CONTENT = "De kat slaapt. Hij droomt.";
const HASH = contentHash(CONTENT);

async function device(id: string, start: number) {
  let t = start;
  return createRepository(await createNodeDriver(), { deviceId: id, now: () => t++ });
}

const tok = (i: number, lemma: string, sent: number): AnalyzedToken =>
  ({ i, text: lemma, lemma, is_word: true, sent }) as unknown as AnalyzedToken;
const TOKENS = [tok(0, "de", 0), tok(1, "kat", 0), tok(2, "slapen", 0), tok(3, "hij", 1)];
const HITS = [{ topic: "inversion", tokens: [0], sent: 0, start: 0, end: 2, note: "" }];
const SENTENCES = [
  {
    sent: 0,
    english: "The cat is sleeping.",
    pairs: [{ nl: [1], en: [1], confidence: 0.9 }],
    align: [[1, "cat", 0.9]] as [number, string, number][],
  },
];

async function twoDevices() {
  const store = memoryStore();
  const a = await device("aaaaaaaaaaaa", T0);
  const b = await device("bbbbbbbbbbbb", T0 + 1000);
  const keyA = (await openVault(store, PASS, true, LIGHT_ARGON2)).key;
  const keyB = (await openVault(store, PASS, false)).key;
  await a.append({
    type: "TextImported",
    textId: "t1",
    title: "Kat",
    lang: "nl",
    source: { kind: "paste" },
    content: CONTENT,
  });
  return { store, a, b, keyA, keyB };
}

describe("text bundles", () => {
  it("carry the analysis, grammar and extras to a device that has none, sealed", async () => {
    const { store, a, b, keyA, keyB } = await twoDevices();
    await a.saveTextAnalysis({
      textId: "t1",
      contentHash: HASH,
      tokens: TOKENS,
      analyzerVersion: "v1",
    });
    await a.saveTextGrammar({ textId: "t1", contentHash: HASH, version: 3, hits: HITS });
    expect(
      await a.saveTextExtras({
        textId: "t1",
        contentHash: HASH,
        analyzerVersion: "v1",
        madeAt: T0 + 5,
        sentences: SENTENCES,
      }),
    ).toBe(true);
    await syncOnce(a, store, keyA, { deviceName: "Laptop" });

    // Nothing readable in the place, and the name does not reveal the text.
    const bundles = [...store.files.keys()].filter((p) => p.includes("/analyses/"));
    expect(bundles).toHaveLength(1);
    expect(bundles[0]).toMatch(/^vuurtoren\/devices\/aaaaaaaaaaaa\/analyses\/[0-9a-f]+\.kan$/);
    expect(new TextDecoder().decode(store.files.get(bundles[0]!)!)).not.toContain("slapen");

    expect(await b.unanalysedTexts()).toEqual([]);
    await syncOnce(b, store, keyB, { deviceName: "Phone" });
    const text = await b.getText("t1");
    expect(text?.tokens?.map((t) => t.lemma)).toEqual(["de", "kat", "slapen", "hij"]);
    expect(text?.analyzerVersion).toBe("v1");
    expect((await b.textGrammar("t1"))?.hits).toEqual(HITS);
    expect((await b.textExtras("t1"))?.sentences).toEqual(SENTENCES);

    // B does not send A's bundle back; A sends nothing new.
    await syncOnce(b, store, keyB, { deviceName: "Phone" });
    expect([...store.files.keys()].filter((p) => p.includes("/analyses/"))).toHaveLength(1);
  });

  it("sends a bundle again when its extras come later, and the other device picks them up", async () => {
    const { store, a, b, keyA, keyB } = await twoDevices();
    await syncOnce(a, store, keyA, { deviceName: "Laptop" });
    await syncOnce(b, store, keyB, { deviceName: "Phone" });
    expect(await b.unanalysedTexts()).toEqual([{ textId: "t1", contentHash: HASH }]);

    await a.saveTextAnalysis({
      textId: "t1",
      contentHash: HASH,
      tokens: TOKENS,
      analyzerVersion: "v1",
    });
    await syncOnce(a, store, keyA, { deviceName: "Laptop" });
    await syncOnce(b, store, keyB, { deviceName: "Phone" });
    expect(await b.textExtras("t1")).toBeNull();
    expect(await b.unanalysedTexts()).toEqual([]);

    await a.saveTextExtras({
      textId: "t1",
      contentHash: HASH,
      analyzerVersion: "v1",
      madeAt: T0 + 50_000,
      sentences: SENTENCES,
    });
    await syncOnce(a, store, keyA, { deviceName: "Laptop" });
    expect([...store.files.keys()].filter((p) => p.includes("/analyses/"))).toHaveLength(1);
    // B has the analysis without extras: it looks for them, and gets them.
    await syncOnce(b, store, keyB, { deviceName: "Phone" });
    expect((await b.textExtras("t1"))?.sentences).toEqual(SENTENCES);
  });

  it("keeps extras only for the analysis they index", async () => {
    const { a } = await twoDevices();
    await a.saveTextAnalysis({
      textId: "t1",
      contentHash: HASH,
      tokens: TOKENS,
      analyzerVersion: "v2",
    });
    expect(
      await a.saveTextExtras({
        textId: "t1",
        contentHash: HASH,
        analyzerVersion: "v1",
        madeAt: T0,
        sentences: SENTENCES,
      }),
    ).toBe(false);
    expect(
      await a.saveTextExtras({
        textId: "t1",
        contentHash: "other",
        analyzerVersion: "v2",
        madeAt: T0,
        sentences: SENTENCES,
      }),
    ).toBe(false);
  });
});
