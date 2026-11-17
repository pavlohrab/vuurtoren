import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AnalyzedToken } from "@app/core";
import { afterEach, describe, expect, it } from "vitest";
import { contentHash } from "./hash.js";
import { compareHlc } from "./ids.js";
import { createNodeDriver } from "./node.js";
import { createRepository, type KenningRepository } from "./repository.js";
import { SCHEMA_VERSION } from "./schema.js";
import type { AnkiWordEntry, AppEvent, SqlDriver } from "./types.js";

const open: KenningRepository[] = [];
afterEach(async () => {
  for (const r of open.splice(0)) await r.close().catch(() => undefined);
});

/** Fresh in-memory repo with a deterministic clock (+1ms per call). */
async function newRepo(
  driver?: SqlDriver,
  start = 1_000_000,
): Promise<{ repo: KenningRepository; driver: SqlDriver }> {
  let t = start;
  const d = driver ?? (await createNodeDriver());
  const repo = await createRepository(d, { deviceId: "dev1", now: () => t++ });
  open.push(repo);
  return { repo, driver: d };
}

const tok = (i: number, lemma: string): AnalyzedToken =>
  ({ i, text: lemma, lemma, is_word: true }) as unknown as AnalyzedToken;

const anki = (key: string, o: Partial<AnkiWordEntry> = {}): AnkiWordEntry => ({
  key,
  state: "known",
  pKnown: 0.9,
  noteIds: [1],
  decks: ["Dutch"],
  ...o,
});

const importText = (textId: string, content = "Dit is een test. Één twee!"): AppEvent => ({
  type: "TextImported",
  textId,
  title: `Title ${textId}`,
  lang: "nl",
  source: { kind: "paste" },
  content,
});

describe("projections", () => {
  it("TextImported creates a summary with a letter-run word count", async () => {
    const { repo } = await newRepo();
    await repo.append(importText("t1"));
    const [s] = await repo.listTexts();
    expect(s).toMatchObject({
      id: "t1",
      title: "Title t1",
      lang: "nl",
      sourceKind: "paste",
      wordCount: 6,
      analyzed: false,
      lastSegment: 0,
    });
    const full = await repo.getText("t1");
    expect(full?.content).toContain("Dit is een test");
    expect(full?.tokens).toBeNull();
    expect(await repo.getText("missing")).toBeNull();
  });

  it("TextAnalyzed stores tokens only when the content hash matches", async () => {
    const { repo } = await newRepo();
    const content = "hallo wereld";
    await repo.append(importText("t1", content));
    await repo.append({
      type: "TextAnalyzed",
      textId: "t1",
      contentHash: "deadbeef",
      tokens: [tok(0, "x")],
    });
    expect((await repo.getText("t1"))?.tokens).toBeNull();
    await repo.append({
      type: "TextAnalyzed",
      textId: "t1",
      contentHash: contentHash(content),
      tokens: [tok(0, "hallo"), tok(1, "wereld")],
    });
    const t = await repo.getText("t1");
    expect(t?.tokens?.map((x) => x.lemma)).toEqual(["hallo", "wereld"]);
    expect(t?.analyzed).toBe(true);
    // Re-import with different content invalidates tokens.
    await repo.append(importText("t1", "iets anders"));
    expect((await repo.getText("t1"))?.tokens).toBeNull();
  });

  it("TextDeleted cascades to tokens and progress", async () => {
    const { repo, driver } = await newRepo();
    await repo.append(importText("t1", "abc"));
    await repo.append({
      type: "TextAnalyzed",
      textId: "t1",
      contentHash: contentHash("abc"),
      tokens: [tok(0, "abc")],
    });
    await repo.append({
      type: "ReadingProgress",
      textId: "t1",
      segment: 2,
      clozeAccuracy: null,
      lookupsPer100: 3,
    });
    expect((await repo.listTexts())[0]?.lastSegment).toBe(2);
    await repo.append({ type: "TextDeleted", textId: "t1" });
    expect(await repo.listTexts()).toEqual([]);
    for (const t of ["texts", "text_tokens", "reading_progress"]) {
      expect(await driver.exec(`SELECT count(*) AS c FROM ${t}`)).toEqual([{ c: 0 }]);
    }
    // Progress for a deleted text is ignored.
    await repo.append({
      type: "ReadingProgress",
      textId: "t1",
      segment: 5,
      clozeAccuracy: null,
      lookupsPer100: 0,
    });
    expect(await driver.exec("SELECT count(*) AS c FROM reading_progress")).toEqual([{ c: 0 }]);
  });

  it("AnkiSnapshotImported replaces the whole language and records the source", async () => {
    const { repo } = await newRepo();
    await repo.append({
      type: "AnkiSnapshotImported",
      lang: "nl",
      entries: [anki("huis", { gloss: "house", article: "het" }), anki("boom")],
      sources: ["a.apkg"],
    });
    await repo.append({
      type: "AnkiSnapshotImported",
      lang: "de",
      entries: [anki("haus")],
      sources: ["d.apkg"],
    });
    expect(await repo.word("nl", "huis")).toMatchObject({
      state: "known",
      source: "anki",
      gloss: "house",
      article: "het",
      decks: ["Dutch"],
    });
    expect((await repo.lastSnapshot("nl"))?.sources).toEqual(["a.apkg"]);
    await repo.append({
      type: "AnkiSnapshotImported",
      lang: "nl",
      entries: [anki("kat", { state: "learning", pKnown: 0.4 })],
      sources: ["b.apkg", "c.apkg"],
    });
    expect(await repo.word("nl", "huis")).toBeNull();
    expect((await repo.words("nl")).map((w) => w.key)).toEqual(["kat"]);
    expect((await repo.words("de")).map((w) => w.key)).toEqual(["haus"]);
    expect(await repo.lastSnapshot("nl")).toEqual({
      at: expect.any(Number),
      sources: ["b.apkg", "c.apkg"],
    });
    expect(await repo.lastSnapshot("fr")).toBeNull();
  });

  it("imports large snapshots", async () => {
    const { repo } = await newRepo();
    const entries = Array.from({ length: 1234 }, (_, i) => anki(`w${i}`));
    await repo.append({ type: "AnkiSnapshotImported", lang: "nl", entries, sources: [] });
    expect((await repo.learnerModel("nl")).size).toBe(1234);
  });

  it("WordStateSet override precedence over Anki", async () => {
    const { repo } = await newRepo();
    await repo.append({
      type: "AnkiSnapshotImported",
      lang: "nl",
      entries: [
        anki("a", { state: "learning", pKnown: 0.5 }),
        anki("b", { state: "known", pKnown: 0.99 }),
        anki("c", { state: "known", pKnown: 0.6 }),
      ],
      sources: [],
    });
    const set = (key: string, state: "known" | "ignored" | "learning" | "unknown") =>
      repo.append({ type: "WordStateSet", lang: "nl", key, state });
    await set("a", "known");
    await set("b", "unknown");
    await set("c", "learning");
    await set("d", "ignored");
    await set("e", "learning");
    expect(await repo.word("nl", "a")).toMatchObject({
      state: "known",
      pKnown: 0.95,
      source: "app",
    });
    expect(await repo.word("nl", "b")).toMatchObject({ state: "unknown", pKnown: 0 });
    expect(await repo.word("nl", "c")).toMatchObject({ state: "learning", pKnown: 0.3 });
    expect(await repo.word("nl", "d")).toMatchObject({ state: "ignored", pKnown: 1 });
    expect(await repo.word("nl", "e")).toMatchObject({ state: "learning", pKnown: 0.3 });
    const model = await repo.learnerModel("nl");
    expect(model.get("a")).toEqual({ state: "known", pKnown: 0.95 });
    expect(model.get("d")).toEqual({ state: "ignored", pKnown: 1 });
    // known keeps a higher Anki p
    await repo.append({
      type: "AnkiSnapshotImported",
      lang: "nl",
      entries: [anki("a", { pKnown: 0.99 })],
      sources: [],
    });
    expect((await repo.word("nl", "a"))?.pKnown).toBe(0.99);
  });

  it("WordStateSet is last-write-wins by HLC regardless of arrival order", async () => {
    const { repo, driver } = await newRepo();
    const a = await repo.append({ type: "WordStateSet", lang: "nl", key: "x", state: "known" });
    const b = await repo.append({ type: "WordStateSet", lang: "nl", key: "x", state: "ignored" });
    expect(compareHlc(a.hlc, b.hlc)).toBeLessThan(0);
    expect((await repo.word("nl", "x"))?.state).toBe("ignored");
    // Replaying the older event after the newer one must not win.
    await driver.exec("DELETE FROM word_overrides");
    await driver.exec("INSERT INTO word_overrides VALUES ('nl','x','ignored',?)", [b.hlc]);
    const { applyEvent } = await import("./projections.js");
    await applyEvent(driver, { id: a.id, hlc: a.hlc, createdAt: 0, event: a.event });
    expect((await repo.word("nl", "x"))?.state).toBe("ignored");
  });

  it("WordLookedUp counts lookups and shows unseen words as 'seen' (0.1)", async () => {
    const { repo } = await newRepo();
    const look = (key: string) =>
      repo.append({ type: "WordLookedUp", lang: "nl", key, textId: "t" });
    await look("fiets");
    await look("fiets");
    expect(await repo.word("nl", "fiets")).toMatchObject({
      state: "seen",
      pKnown: 0.1,
      lookups: 2,
      source: "app",
    });
    expect((await repo.learnerModel("nl")).get("fiets")).toEqual({ state: "seen", pKnown: 0.1 });
    // With an Anki entry the state is unchanged but lookups are tracked.
    await repo.append({
      type: "AnkiSnapshotImported",
      lang: "nl",
      entries: [anki("huis")],
      sources: [],
    });
    await look("huis");
    expect(await repo.word("nl", "huis")).toMatchObject({ state: "known", lookups: 1 });
    expect(await repo.word("nl", "zzz")).toBeNull();
  });

  it("NoteAddedToAnki makes a word 'learning' (0.2) unless Anki already has it", async () => {
    const { repo } = await newRepo();
    await repo.append({
      type: "NoteAddedToAnki",
      lang: "nl",
      key: "kaas",
      noteId: 77,
      deck: "New",
    });
    expect(await repo.word("nl", "kaas")).toMatchObject({
      state: "learning",
      pKnown: 0.2,
      addedNoteId: 77,
      decks: ["New"],
    });
    await repo.append({
      type: "AnkiSnapshotImported",
      lang: "nl",
      entries: [anki("kaas", { pKnown: 0.8 })],
      sources: [],
    });
    expect(await repo.word("nl", "kaas")).toMatchObject({
      state: "known",
      pKnown: 0.8,
      addedNoteId: 77,
      decks: ["Dutch", "New"],
    });
  });

  it("a snapshot listing the added card as still new does not demote the word", async () => {
    const { repo } = await newRepo();
    await repo.append({
      type: "NoteAddedToAnki",
      lang: "nl",
      key: "kaas",
      noteId: 77,
      deck: "New",
    });
    await repo.append({
      type: "AnkiSnapshotImported",
      lang: "nl",
      entries: [anki("kaas", { state: "unknown", pKnown: 0 })],
      sources: [],
    });
    expect(await repo.word("nl", "kaas")).toMatchObject({ state: "learning", pKnown: 0.2 });
    expect((await repo.learnerModel("nl")).get("kaas")).toEqual({ state: "learning", pKnown: 0.2 });
  });

  it("StaircaseUpdated and SettingChanged are stored", async () => {
    const { repo } = await newRepo();
    expect(await repo.staircase("nl")).toBeNull();
    expect(await repo.setting("theme")).toBeUndefined();
    const state = { level: 3 } as never;
    await repo.append({ type: "StaircaseUpdated", lang: "nl", state });
    await repo.append({ type: "SettingChanged", key: "theme", value: { dark: true } });
    await repo.append({ type: "SettingChanged", key: "n", value: 0 });
    expect(await repo.staircase("nl")).toEqual(state);
    expect(await repo.setting("theme")).toEqual({ dark: true });
    expect(await repo.setting("n")).toBe(0);
    await repo.append({ type: "SettingChanged", key: "theme", value: "light" });
    expect(await repo.setting("theme")).toBe("light");
  });

  it("words() filters by state, prefix and pages", async () => {
    const { repo } = await newRepo();
    await repo.append({
      type: "AnkiSnapshotImported",
      lang: "nl",
      entries: [
        anki("aap"),
        anki("appel", { state: "learning", pKnown: 0.4 }),
        anki("boom"),
        anki("bos", { state: "learning", pKnown: 0.3 }),
      ],
      sources: [],
    });
    expect((await repo.words("nl", { state: "learning" })).map((w) => w.key)).toEqual([
      "appel",
      "bos",
    ]);
    expect((await repo.words("nl", { query: "AP" })).map((w) => w.key)).toEqual(["appel"]);
    expect((await repo.words("nl", { limit: 2, offset: 1 })).map((w) => w.key)).toEqual([
      "appel",
      "boom",
    ]);
  });
});

describe("event log", () => {
  it("assigns increasing ids and hlcs and lists events since an id", async () => {
    const { repo } = await newRepo();
    const a = await repo.append({ type: "SettingChanged", key: "a", value: 1 });
    const b = await repo.append({ type: "SettingChanged", key: "b", value: 2 });
    expect(b.id > a.id).toBe(true);
    expect(a.deviceId).toBe("dev1");
    expect(a.hlc.endsWith("-dev1")).toBe(true);
    expect((await repo.events()).map((e) => e.id)).toEqual([a.id, b.id]);
    expect((await repo.events(a.id)).map((e) => e.id)).toEqual([b.id]);
    expect((await repo.events())[0]?.event).toEqual(a.event);
  });

  it("is append-only", async () => {
    const { repo, driver } = await newRepo();
    await repo.append({ type: "SettingChanged", key: "a", value: 1 });
    await expect(driver.exec("UPDATE events SET type = 'x'")).rejects.toThrow(/append-only/);
  });

  it("rolls back the event if the projection fails", async () => {
    const real = await createNodeDriver();
    let fail = false;
    const flaky: SqlDriver = {
      ...real,
      exec: (sql, params) => {
        if (fail && sql.includes("INTO settings")) return Promise.reject(new Error("disk full"));
        return real.exec(sql, params);
      },
      transaction: (fn) => real.transaction(fn),
    };
    const { repo } = await newRepo(flaky);
    await repo.append({ type: "SettingChanged", key: "a", value: 1 });
    fail = true;
    await expect(repo.append({ type: "SettingChanged", key: "b", value: 2 })).rejects.toThrow(
      "disk full",
    );
    fail = false;
    expect(await repo.events()).toHaveLength(1);
    expect(await repo.setting("b")).toBeUndefined();
    // Repository still usable afterwards.
    await repo.append({ type: "SettingChanged", key: "c", value: 3 });
    expect(await repo.events()).toHaveLength(2);
  });

  it("serialises concurrent appends", async () => {
    const { repo } = await newRepo();
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        repo.append({ type: "WordLookedUp", lang: "nl", key: "w", textId: String(i) }),
      ),
    );
    expect((await repo.word("nl", "w"))?.lookups).toBe(50);
  });
});

describe("rebuild equivalence", () => {
  /** Seeded PRNG (mulberry32). */
  function rng(seed: number): () => number {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  async function snapshot(repo: KenningRepository): Promise<unknown> {
    const texts = await repo.listTexts();
    return {
      texts,
      full: await Promise.all(texts.map((t) => repo.getText(t.id))),
      words: Object.fromEntries(
        await Promise.all(["nl", "de"].map(async (l) => [l, await repo.words(l)] as const)),
      ),
      models: await Promise.all(
        ["nl", "de"].map(async (l) => [...(await repo.learnerModel(l))].sort()),
      ),
      staircase: await Promise.all(["nl", "de"].map((l) => repo.staircase(l))),
      settings: await Promise.all(["a", "b", "c"].map((k) => repo.setting(k))),
      snaps: await Promise.all(["nl", "de"].map((l) => repo.lastSnapshot(l))),
    };
  }

  it.each([1, 2, 3])("replay matches live projections (seed %i)", async (seed) => {
    const rand = rng(seed);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
    const langs = ["nl", "de"];
    const keys = ["aap", "boom", "huis", "kat", "dak", "eend"];
    const texts = new Map<string, string>();
    const { repo } = await newRepo();
    const states = ["unknown", "seen", "learning", "known", "ignored"] as const;

    for (let n = 0; n < 200; n++) {
      const r = rand();
      let event: AppEvent;
      if (r < 0.1) {
        const id = pick(["t1", "t2", "t3"]);
        const content = `tekst ${Math.floor(rand() * 3)} met woorden ${n}`;
        texts.set(id, content);
        event = importText(id, content);
      } else if (r < 0.18) {
        const id = pick(["t1", "t2", "t3"]);
        const content = texts.get(id) ?? "";
        event = {
          type: "TextAnalyzed",
          textId: id,
          contentHash: rand() < 0.7 ? contentHash(content) : "bad",
          tokens: [tok(0, "x")],
        };
      } else if (r < 0.22) {
        event = { type: "TextDeleted", textId: pick(["t1", "t2", "t3"]) };
      } else if (r < 0.28) {
        event = {
          type: "AnkiSnapshotImported",
          lang: pick(langs),
          entries: keys
            .filter(() => rand() < 0.6)
            .map((k) => anki(k, { state: pick(states), pKnown: Math.round(rand() * 100) / 100 })),
          sources: [`s${n}`],
        };
      } else if (r < 0.45) {
        event = { type: "WordStateSet", lang: pick(langs), key: pick(keys), state: pick(states) };
      } else if (r < 0.65) {
        event = { type: "WordLookedUp", lang: pick(langs), key: pick(keys), textId: "t1" };
      } else if (r < 0.72) {
        event = {
          type: "NoteAddedToAnki",
          lang: pick(langs),
          key: pick(keys),
          noteId: n,
          deck: pick(["D1", "D2"]),
        };
      } else if (r < 0.82) {
        event = {
          type: "ReadingProgress",
          textId: pick(["t1", "t2", "t3"]),
          segment: n,
          clozeAccuracy: null,
          lookupsPer100: 1,
        };
      } else if (r < 0.9) {
        event = { type: "StaircaseUpdated", lang: pick(langs), state: { n } as never };
      } else {
        event = { type: "SettingChanged", key: pick(["a", "b", "c"]), value: { n } };
      }
      await repo.append(event);
    }

    const before = await snapshot(repo);
    await repo.rebuild();
    expect(await snapshot(repo)).toEqual(before);
    // Rebuilding twice is stable too.
    await repo.rebuild();
    expect(await snapshot(repo)).toEqual(before);
    expect((await repo.events()).length).toBe(200);
  });
});

describe("file database", () => {
  it("migrations are idempotent across reopen and data persists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kenning-db-"));
    try {
      const file = join(dir, "k.db");
      const first = await createNodeDriver(file);
      const r1 = await createRepository(first, { now: () => 5 });
      const deviceId = r1.deviceId;
      await r1.append({ type: "SettingChanged", key: "a", value: 1 });
      await r1.close();

      const second = await createNodeDriver(file);
      const r2 = await createRepository(second, { now: () => 5 });
      expect(r2.deviceId).toBe(deviceId);
      expect(await r2.setting("a")).toBe(1);
      expect(await second.exec("PRAGMA user_version")).toEqual([{ user_version: SCHEMA_VERSION }]);
      // Clocks resume past stored events even if the wall clock is stuck.
      const next = await r2.append({ type: "SettingChanged", key: "a", value: 2 });
      const [prev] = await r2.events();
      expect(next.id > (prev?.id ?? "")).toBe(true);
      expect(compareHlc(next.hlc, prev?.hlc ?? "")).toBeGreaterThan(0);
      await r2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a database from a newer schema", async () => {
    const d = await createNodeDriver();
    await d.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    await expect(createRepository(d)).rejects.toThrow(/newer/);
  });
});
