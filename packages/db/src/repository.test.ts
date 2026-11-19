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
  clock: { t: number; frozen?: boolean } = { t: start },
): Promise<{ repo: KenningRepository; driver: SqlDriver }> {
  const d = driver ?? (await createNodeDriver());
  const repo = await createRepository(d, {
    deviceId: "dev1",
    now: () => (clock.frozen ? clock.t : clock.t++),
  });
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

  it("TextAnalyzed keeps the analyzer version; a new version drops the grammar hits (A4)", async () => {
    const { repo } = await newRepo();
    const content = "De kat slaapt.";
    const hash = contentHash(content);
    await repo.append(importText("t1", content));
    await repo.append({
      type: "TextAnalyzed",
      textId: "t1",
      contentHash: hash,
      tokens: [tok(0, "kat")],
    });
    expect((await repo.getText("t1"))?.analyzerVersion).toBeNull();
    const grammar: AppEvent = {
      type: "TextGrammarDetected",
      textId: "t1",
      contentHash: hash,
      version: 1,
      hits: [],
    };
    await repo.append(grammar);
    await repo.append({
      type: "TextAnalyzed",
      textId: "t1",
      contentHash: hash,
      tokens: [tok(0, "kat")],
      analyzerVersion: "a1-new",
    });
    expect((await repo.getText("t1"))?.analyzerVersion).toBe("a1-new");
    expect(await repo.textGrammar("t1")).toBeNull();
    // The same version again keeps freshly computed hits.
    await repo.append(grammar);
    await repo.append({
      type: "TextAnalyzed",
      textId: "t1",
      contentHash: hash,
      tokens: [tok(0, "kat")],
      analyzerVersion: "a1-new",
    });
    expect(await repo.textGrammar("t1")).not.toBeNull();
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
    // The projection stores the next segment to read: finished segment 2 -> resume at 3.
    expect((await repo.listTexts())[0]?.lastSegment).toBe(3);
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

  it("TextGrammarDetected stores hits for the current content only", async () => {
    const { repo, driver } = await newRepo();
    const content = "Morgen ga ik naar school.";
    const hits = [
      { topic: "inversion", tokens: [1, 2], sent: 0, start: 0, end: 25, note: "verb first" },
    ];
    const detected = (textId: string, hash = contentHash(content)): AppEvent => ({
      type: "TextGrammarDetected",
      textId,
      contentHash: hash,
      version: 1,
      hits,
    });
    expect(await repo.textGrammar("t1")).toBeNull();
    await repo.append(detected("t1")); // unknown text: ignored
    await repo.append(importText("t1", content));
    await repo.append(detected("t1", contentHash("something else"))); // stale: ignored
    expect(await repo.textGrammar("t1")).toBeNull();
    await repo.append(detected("t1"));
    expect(await repo.textGrammar("t1")).toEqual({ textId: "t1", version: 1, hits });
    await repo.append(importText("t2", "Ik werk niet."));
    expect((await repo.allTextGrammar()).map((g) => g.textId)).toEqual(["t1"]);

    // Replays give the same projection.
    await repo.rebuild();
    expect(await repo.textGrammar("t1")).toEqual({ textId: "t1", version: 1, hits });

    // New content makes the hits stale; deleting the text removes them.
    await repo.append(importText("t1", "Andere tekst."));
    expect(await repo.textGrammar("t1")).toBeNull();
    await repo.append(importText("t1", content));
    await repo.append(detected("t1"));
    await repo.append({ type: "TextDeleted", textId: "t1" });
    expect(await repo.allTextGrammar()).toEqual([]);
    expect(await driver.exec("SELECT count(*) AS c FROM text_grammar")).toEqual([{ c: 0 }]);
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
    await driver.exec(
      "INSERT INTO word_overrides (lang, key, state, updated_hlc) VALUES ('nl','x','ignored',?)",
      [b.hlc],
    );
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

  it("CardsPrioritized makes a word 'learning' (0.2) until Anki has real reviews", async () => {
    const { repo } = await newRepo();
    await repo.append({
      type: "AnkiSnapshotImported",
      lang: "nl",
      entries: [anki("kaas", { state: "unknown", pKnown: 0, noteIds: [5, 6] })],
      sources: [],
    });
    expect(await repo.word("nl", "kaas")).toMatchObject({ state: "unknown", noteIds: [5, 6] });
    await repo.append({
      type: "CardsPrioritized",
      lang: "nl",
      key: "kaas",
      noteId: 5,
      cardIds: [50],
      unsuspended: [],
    });
    expect(await repo.word("nl", "kaas")).toMatchObject({
      state: "learning",
      pKnown: 0.2,
      prioritized: true,
      source: "app",
    });
    // The next snapshot still lists the card as new: must not demote.
    await repo.append({
      type: "AnkiSnapshotImported",
      lang: "nl",
      entries: [anki("kaas", { state: "unknown", pKnown: 0 })],
      sources: [],
    });
    expect((await repo.learnerModel("nl")).get("kaas")).toEqual({ state: "learning", pKnown: 0.2 });
    // Real evidence wins, and the flag stays.
    await repo.append({
      type: "AnkiSnapshotImported",
      lang: "nl",
      entries: [anki("kaas", { state: "learning", pKnown: 0.5 })],
      sources: [],
    });
    expect(await repo.word("nl", "kaas")).toMatchObject({
      state: "learning",
      pKnown: 0.5,
      source: "anki",
      prioritized: true,
    });
  });

  it("MarkedKnownInAnki acts like a known override and is recorded", async () => {
    const { repo } = await newRepo();
    await repo.append({
      type: "AnkiSnapshotImported",
      lang: "nl",
      entries: [anki("kaas", { state: "unknown", pKnown: 0 })],
      sources: [],
    });
    await repo.append({
      type: "MarkedKnownInAnki",
      lang: "nl",
      key: "kaas",
      noteIds: [1],
      cardIds: [10],
    });
    expect(await repo.word("nl", "kaas")).toMatchObject({
      state: "known",
      pKnown: 0.95,
      source: "app",
      markedKnownInAnki: true,
      overridden: true,
    });
    // A later plain state change replaces the mark.
    await repo.append({ type: "WordStateSet", lang: "nl", key: "kaas", state: "ignored" });
    const w = await repo.word("nl", "kaas");
    expect(w?.state).toBe("ignored");
    expect(w?.markedKnownInAnki).toBeUndefined();
  });

  it("WordStateCleared removes the override so Anki's state applies again", async () => {
    const { repo } = await newRepo();
    await repo.append({
      type: "AnkiSnapshotImported",
      lang: "nl",
      entries: [anki("kaas", { state: "learning", pKnown: 0.4 })],
      sources: [],
    });
    await repo.append({
      type: "MarkedKnownInAnki",
      lang: "nl",
      key: "kaas",
      noteIds: [1],
      cardIds: [10],
    });
    await repo.append({ type: "WordStateCleared", lang: "nl", key: "kaas" });
    const w = await repo.word("nl", "kaas");
    expect(w).toMatchObject({ state: "learning", pKnown: 0.4, source: "anki" });
    expect(w?.overridden).toBeUndefined();
    expect(w?.markedKnownInAnki).toBeUndefined();
    // Clearing a word that has no override is harmless, and a looked-up word stays "seen".
    await repo.append({ type: "WordStateCleared", lang: "nl", key: "nieuw" });
    expect(await repo.word("nl", "nieuw")).toBeNull();
  });

  it("WordStateCleared respects HLC order when replayed late", async () => {
    const { repo, driver } = await newRepo();
    const a = await repo.append({ type: "WordStateSet", lang: "nl", key: "x", state: "known" });
    const b = await repo.append({ type: "WordStateCleared", lang: "nl", key: "x" });
    const { applyEvent } = await import("./projections.js");
    await applyEvent(driver, { id: a.id, hlc: a.hlc, createdAt: 0, event: a.event });
    expect(await repo.word("nl", "x")).toBeNull();
    expect(b.hlc > a.hlc).toBe(true);
  });

  it("noteIds include the note the app added", async () => {
    const { repo } = await newRepo();
    await repo.append({
      type: "NoteAddedToAnki",
      lang: "nl",
      key: "kaas",
      noteId: 77,
      deck: "New",
    });
    expect((await repo.word("nl", "kaas"))?.noteIds).toEqual([77]);
  });

  it("rebuilds projections once when the projection version changes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kenning-pv-"));
    try {
      const path = join(dir, "db.sqlite");
      let repo = await createRepository(await createNodeDriver(path));
      await repo.append({
        type: "TextImported",
        textId: "t",
        title: "T",
        lang: "nl",
        source: { kind: "paste" },
        content: "a b c",
      });
      await repo.append({
        type: "ReadingProgress",
        textId: "t",
        segment: 0,
        clozeAccuracy: null,
        lookupsPer100: 0,
      });
      // simulate an old database: stale projection value + old version marker
      const d = await createNodeDriver(path);
      await repo.close();
      await d.exec("UPDATE reading_progress SET last_segment = 0");
      await d.exec("UPDATE meta SET value = '1' WHERE key = 'projection_version'");
      await d.close();
      repo = await createRepository(await createNodeDriver(path));
      expect((await repo.listTexts())[0]?.lastSegment).toBe(1);
      await repo.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

function answered(
  lang: string,
  key: string,
  skill: "recognition" | "recall" | "form",
  at: number,
  grade: "again" | "good" = "good",
): AppEvent {
  return {
    type: "ExerciseAnswered",
    lang,
    key,
    skill,
    kind: "meaning-choice",
    grade,
    correct: grade === "good",
    ms: 1200,
    at,
    state: {
      key,
      skill,
      due: at + 1000,
      stability: 2,
      difficulty: 5,
      elapsedDays: 0,
      scheduledDays: 1,
      reps: 1,
      lapses: 0,
      state: 1,
      lastReview: at,
    },
  };
}

describe("activity", () => {
  it("lists pages read, exercises answered and words added since a time", async () => {
    const { repo } = await newRepo();
    await repo.append(answered("nl", "huis", "recognition", 100));
    await repo.append({
      type: "ReadingProgress",
      textId: "t",
      segment: 0,
      clozeAccuracy: null,
      lookupsPer100: 0,
    });
    await repo.append({ type: "WordLookedUp", lang: "nl", key: "huis", textId: "t" });
    const all = await repo.activity(0);
    expect(all.map((a) => a.kind).sort()).toEqual(["exercise", "page"]);
    expect(all.every((a) => typeof a.at === "number")).toBe(true);
    expect(await repo.activity(Date.now() + 60_000)).toEqual([]);
  });
});

describe("practice events", () => {
  it("projects the newest state per (key, skill) and lists the log newest first", async () => {
    const { repo } = await newRepo();
    await repo.append(answered("nl", "huis", "recognition", 100));
    await repo.append(answered("nl", "huis", "recall", 110));
    await repo.append(answered("nl", "huis", "recognition", 200, "again"));
    await repo.append(answered("nl", "huis", "recognition", 150)); // late arrival, older
    await repo.append(answered("de", "haus", "recognition", 120));
    const items = await repo.practiceItems("nl");
    expect(items.map((i) => [i.skill, i.lastReview])).toEqual([
      ["recall", 110],
      ["recognition", 200],
    ]);
    const log = await repo.practiceLog("nl", 2);
    expect(log.map((l) => l.at)).toEqual([150, 200]);
    expect(log[1]).toMatchObject({
      key: "huis",
      grade: "again",
      correct: false,
      kind: "meaning-choice",
    });
    expect(await repo.practiceItems("fr")).toEqual([]);
  });

  it("stores Anki sentences in the word projection", async () => {
    const { repo } = await newRepo();
    await repo.append({
      type: "AnkiSnapshotImported",
      lang: "nl",
      entries: [
        anki("huis", { sentence: "Het huis is groot.", sentenceTranslation: "The house is big." }),
      ],
      sources: ["s"],
    });
    expect(await repo.word("nl", "huis")).toMatchObject({
      sentence: "Het huis is groot.",
      sentenceTranslation: "The house is big.",
    });
    await repo.rebuild();
    expect((await repo.word("nl", "huis"))?.sentence).toBe("Het huis is groot.");
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
      practice: await Promise.all(["nl", "de"].map((l) => repo.practiceItems(l))),
      log: await Promise.all(["nl", "de"].map((l) => repo.practiceLog(l, 1000))),
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
    // Composed pKnown fades app evidence with the clock: compare both snapshots at one instant.
    const clock = { t: 1_000_000, frozen: false };
    const { repo } = await newRepo(undefined, clock.t, clock);
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
      } else if (r < 0.77) {
        const [lang, key] = [pick(langs), pick(keys)];
        const k = rand();
        event =
          k < 0.4
            ? { type: "CardsPrioritized", lang, key, noteId: n, cardIds: [n], unsuspended: [] }
            : k < 0.7
              ? { type: "MarkedKnownInAnki", lang, key, noteIds: [n], cardIds: [n] }
              : { type: "WordStateCleared", lang, key };
      } else if (r < 0.82) {
        event = {
          type: "ReadingProgress",
          textId: pick(["t1", "t2", "t3"]),
          segment: n,
          clozeAccuracy: null,
          lookupsPer100: 1,
        };
      } else if (r < 0.86) {
        const skill = pick(["recognition", "recall", "form"] as const);
        const key = pick(keys);
        event = answered(pick(langs), key, skill, Math.floor(rand() * 1000));
      } else if (r < 0.88) {
        event = {
          type: "ClozeAnswered",
          lang: pick(langs),
          key: pick(keys),
          correct: rand() < 0.7,
          hinted: rand() < 0.3,
          at: Math.floor(rand() * 1000),
        };
      } else if (r < 0.9) {
        event = { type: "StaircaseUpdated", lang: pick(langs), state: { n } as never };
      } else {
        event = { type: "SettingChanged", key: pick(["a", "b", "c"]), value: { n } };
      }
      await repo.append(event);
    }

    clock.frozen = true;
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

  it("lists the keys looked up in one text, in order of first lookup", async () => {
    const { repo } = await newRepo();
    const look = (key: string, textId: string, lang = "nl") =>
      repo.append({ type: "WordLookedUp", lang, key, textId });
    await look("beta", "t1");
    await look("alfa", "t1");
    await look("beta", "t1");
    await look("gamma", "t2");
    await look("delta", "t1", "uk");
    expect(await repo.lookedUpKeys("nl", "t1")).toEqual(["beta", "alfa"]);
    expect(await repo.lookedUpKeys("nl", "t2")).toEqual(["gamma"]);
    expect(await repo.lookedUpKeys("nl", "missing")).toEqual([]);
  });
});

describe("batched reads and head", () => {
  it("wordsByKeys and getTexts equal the single-item calls", async () => {
    const { repo } = await newRepo();
    await repo.append({
      type: "AnkiSnapshotImported",
      lang: "nl",
      sources: ["D"],
      entries: [
        anki("fiets", { gloss: "bike" }),
        anki("huis"),
        anki("kaas", { state: "learning" }),
      ],
    });
    await repo.append({ type: "WordStateSet", lang: "nl", key: "boom", state: "learning" });
    const keys = ["kaas", "nope", "boom", "fiets"];
    const batch = await repo.wordsByKeys("nl", keys);
    const single = (await Promise.all(keys.map((k) => repo.word("nl", k)))).filter((w) => w);
    expect(batch).toEqual([...single].sort((a, b) => (a!.key < b!.key ? -1 : 1)));
    expect(await repo.wordsByKeys("nl", [])).toEqual([]);

    for (const [id, content] of [
      ["a", "Een fiets."],
      ["b", "Het huis."],
    ] as const) {
      await repo.append({
        type: "TextImported",
        textId: id,
        title: id,
        lang: "nl",
        source: { kind: "paste" },
        content,
      });
    }
    await repo.append({
      type: "TextAnalyzed",
      textId: "b",
      contentHash: contentHash("Het huis."),
      tokens: [tok(0, "huis")],
    });
    const texts = await repo.getTexts(["b", "missing", "a"]);
    expect(texts).toEqual([await repo.getText("b"), await repo.getText("a")]);
    expect(texts[0]!.tokens).toHaveLength(1);
  });

  it("head rises by one per append", async () => {
    const { repo } = await newRepo();
    expect(await repo.head()).toEqual({ deviceId: "dev1", seq: 0 });
    await repo.append({ type: "SettingChanged", key: "x", value: 1 });
    await repo.append({ type: "SettingChanged", key: "x", value: 2 });
    expect(await repo.head()).toEqual({ deviceId: "dev1", seq: 2 });
  });
});
