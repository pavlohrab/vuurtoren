import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SCHEMA_VERSION, contentHash } from "@app/db";
import { createHttpAdmin, createHttpRepository, fetchServerHealth, HttpError } from "@app/db/http";
import { createApiServer } from "./server.js";
import { openStore, type Store } from "./store.js";

let dir: string;
let store: Store;
let server: ReturnType<typeof createApiServer>;
let base: string;

async function start(token?: string): Promise<void> {
  store = await openStore(join(dir, "kenning.sqlite"));
  server = createApiServer({ store, token, maxBodyBytes: 50 * 1024 * 1024 });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kenning-api-"));
});
afterEach(async () => {
  await new Promise((r) => server?.close(r));
  await store?.close();
  rmSync(dir, { recursive: true, force: true });
});

const rpc = (method: string, args: unknown = [], headers: Record<string, string> = {}) =>
  fetch(`${base}/api/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ method, args }),
  });

describe("rpc allow-list", () => {
  beforeEach(() => start());

  it("serves allowed methods", async () => {
    const res = await rpc("listTexts");
    expect(await res.json()).toEqual({ ok: true, result: [] });
  });

  it.each(["exec", "close", "exclusive", "constructor", "__proto__", "deviceId", ""])(
    "rejects %j (never raw SQL or non-listed members)",
    async (m) => {
      const res = await rpc(m, ["SELECT 1"]);
      expect(res.status).toBe(400);
    },
  );

  it("validates argument shapes", async () => {
    expect((await rpc("word", ["nl"])).status).toBe(400);
    expect((await rpc("getText", [42])).status).toBe(400);
    expect((await rpc("listTexts", "x")).status).toBe(400);
    expect((await rpc("listTexts", [1, 2])).status).toBe(400);
  });

  it("health is open and shows state", async () => {
    expect(await fetchServerHealth(base)).toMatchObject({
      state: "ready",
      authRequired: false,
      schemaVersion: SCHEMA_VERSION,
    });
  });

  it("answers null for a non-Kenning origin", async () => {
    expect(await fetchServerHealth("http://127.0.0.1:1")).toBeNull();
  });
});

describe("bearer token", () => {
  beforeEach(() => start("s3cret"));

  it("protects everything but health", async () => {
    expect((await rpc("listTexts")).status).toBe(401);
    expect((await rpc("listTexts", [], { authorization: "Bearer nope" })).status).toBe(401);
    expect((await fetch(`${base}/api/export`)).status).toBe(401);
    expect((await rpc("listTexts", [], { authorization: "Bearer s3cret" })).status).toBe(200);
    expect(await fetchServerHealth(base)).toMatchObject({ authRequired: true });
  });

  it("the http repository reports 401 for a wrong token", async () => {
    await expect(createHttpRepository(base, "bad")).rejects.toMatchObject({ status: 401 });
    await expect(createHttpRepository(base, "s3cret")).resolves.toBeDefined();
  });
});

describe("http repository", () => {
  beforeEach(() => start());

  it("round-trips events, queries and the learner model Map", async () => {
    const repo = await createHttpRepository(base);
    await repo.append({
      type: "TextImported",
      textId: "t1",
      title: "Hallo",
      lang: "nl",
      source: { kind: "paste" },
      content: "Hallo wereld",
    });
    await repo.append({ type: "WordStateSet", lang: "nl", key: "huis", state: "known" });
    await repo.append({ type: "SettingChanged", key: "theme", value: { a: 1 } });
    expect((await repo.listTexts()).map((t) => t.id)).toEqual(["t1"]);
    expect((await repo.getText("t1"))?.content).toBe("Hallo wereld");
    expect(await repo.getText("missing")).toBeNull();
    expect(await repo.setting("theme")).toEqual({ a: 1 });
    expect(await repo.setting("none")).toBeUndefined();
    const model = await repo.learnerModel("nl");
    expect(model).toBeInstanceOf(Map);
    expect(model.get("huis")?.state).toBe("known");
    expect((await repo.words("nl", { state: "known" })).map((w) => w.key)).toEqual(["huis"]);
    expect((await repo.events()).length).toBe(3);
    expect(await repo.eventCount()).toBe(3);
    expect(await repo.events((await repo.events())[2]!.id)).toEqual([]);
    expect((await repo.info()).eventCount).toBe(3);
  });

  it("serves the course queries (Courses in server storage mode)", async () => {
    const repo = await createHttpRepository(base);
    const course = {
      id: "c1",
      title: "Boek",
      lang: "nl",
      source: { kind: "pdf" as const, filename: "boek.pdf" },
      pageCount: 20,
      created: 1,
    };
    const unit = {
      courseId: "c1",
      n: 1,
      title: "Thema 1 Wonen",
      pages: [1, 20] as [number, number],
      ankiDecks: [],
      kind: "theme" as const,
    };
    await repo.append({ type: "CourseImported", course });
    await repo.append({ type: "UnitDefined", courseId: "c1", units: [unit] });
    await repo.append({
      type: "BlocksExtracted",
      courseId: "c1",
      blocks: [{ page: 2, kind: "exercise", number: 1, label: "Oefening 1", text: "Vul in." }],
    });
    await repo.append({
      type: "BookExerciseExtracted",
      courseId: "c1",
      unitN: 1,
      exercises: [
        {
          number: 1,
          page: 2,
          instruction: "Vul in.",
          type: "gapfill",
          items: [{ prompt: "Ik ____ hier.", answer: "woon", answerSource: "derived", confidence: 0.9 }],
          raw: "Vul in.",
        },
      ],
    });
    await repo.append({
      type: "UnitWordsSet",
      courseId: "c1",
      unitN: 1,
      words: [{ lemma: "wonen", source: "wordlist" }],
    });
    await repo.append({
      type: "BookExerciseAnswered",
      courseId: "c1",
      unitN: 1,
      number: 1,
      item: 0,
      answer: "woon",
      correct: true,
      at: 5,
    });
    expect(await repo.courses()).toEqual([{ ...course, units: [unit] }]);
    expect((await repo.courseBlocks("c1")).map((b) => b.label)).toEqual(["Oefening 1"]);
    expect((await repo.unitExercises("c1", 1)).map((e) => e.number)).toEqual([1]);
    expect((await repo.unitWords("c1", 1)).map((w) => w.lemma)).toEqual(["wonen"]);
    expect(await repo.bookAnswers("c1")).toEqual(await repo.bookAnswers("c1", 1));
    expect((await repo.bookAnswers("c1", 1))[0]).toMatchObject({ answer: "woon", correct: true });
    expect((await rpc("unitWords", ["c1", "1"])).status).toBe(400);
  });

  it("serves stored grammar hits (M5)", async () => {
    const repo = await createHttpRepository(base);
    const content = "Morgen ga ik naar school.";
    await repo.append({
      type: "TextImported",
      textId: "t1",
      title: "Morgen",
      lang: "nl",
      source: { kind: "paste" },
      content,
    });
    const hits = [{ topic: "inversion", tokens: [1, 2], sent: 0, start: 0, end: 25, note: "n" }];
    await repo.append({
      type: "TextGrammarDetected",
      textId: "t1",
      contentHash: contentHash(content),
      version: 1,
      hits,
    });
    expect(await repo.textGrammar("t1")).toEqual({ textId: "t1", version: 1, hits });
    expect(await repo.textGrammar("t2")).toBeNull();
    expect((await repo.allTextGrammar()).map((g) => g.textId)).toEqual(["t1"]);
  });

  it("reports server errors as HttpError", async () => {
    const repo = await createHttpRepository(base);
    await expect(repo.practiceLog("nl", Number.NaN as number)).rejects.toBeInstanceOf(HttpError);
  });
});

describe("export / import", () => {
  beforeEach(() => start());

  it("round-trips a backup into a fresh server with a new device id", async () => {
    const a = await createHttpRepository(base);
    await a.append({ type: "WordStateSet", lang: "nl", key: "fiets", state: "known" });
    await a.append({ type: "SettingChanged", key: "k", value: 7 });
    const oldDevice = a.deviceId;
    const res = await fetch(`${base}/api/export`);
    expect(res.headers.get("content-disposition")).toMatch(
      /filename="kenning-\d{4}-\d{2}-\d{2}\.sqlite"/,
    );
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Buffer.from(bytes).subarray(0, 15).toString()).toBe("SQLite format 3");
    // no temp files left behind after streaming
    await new Promise((r) => setTimeout(r, 50));
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);

    // fresh server on another file
    await new Promise((r) => server.close(r));
    await store.close();
    rmSync(dir, { recursive: true });
    dir = mkdtempSync(join(tmpdir(), "kenning-api-"));
    await start();
    await createHttpAdmin(base).importBackup(bytes);

    const b = await createHttpRepository(base);
    expect(b.deviceId).not.toBe(oldDevice);
    expect((await b.learnerModel("nl")).get("fiets")?.state).toBe("known");
    expect(await b.setting("k")).toBe(7);
    expect(await b.eventCount()).toBe(2);
    // events keep their original device id; new writes use the new one
    const ev = await b.append({ type: "SettingChanged", key: "k", value: 8 });
    expect(ev.deviceId).toBe(b.deviceId);
    expect((await b.events())[0]!.deviceId).toBe(oldDevice);
  });

  it("rejects non-SQLite, newer and foreign databases and keeps the data", async () => {
    const repo = await createHttpRepository(base);
    await repo.append({ type: "SettingChanged", key: "k", value: 1 });
    const post = (body: Uint8Array) =>
      fetch(`${base}/api/import`, {
        method: "POST",
        headers: { "x-kenning": "1" },
        body: Buffer.from(body),
      });

    expect((await post(new TextEncoder().encode("hello, not a database"))).status).toBe(422);

    const make = (sql: string): Uint8Array => {
      const f = join(dir, "cand.sqlite");
      rmSync(f, { force: true });
      const db = new DatabaseSync(f);
      db.exec(sql);
      db.close();
      return new Uint8Array(Buffer.from(readFileSyncBytes(f)));
    };
    const newer = make(
      `CREATE TABLE meta (key, value); CREATE TABLE events (id); PRAGMA user_version = ${SCHEMA_VERSION + 1}`,
    );
    const r = await post(newer);
    expect(r.status).toBe(422);
    expect(((await r.json()) as { error: string }).error).toMatch(/newer/);

    const foreign = make("CREATE TABLE other (a); PRAGMA user_version = 1");
    expect((await post(foreign)).status).toBe(422);
    writeFileSync(join(dir, "unused"), "");

    expect(await repo.setting("k")).toBe(1);
    expect(await repo.eventCount()).toBe(1);
  });
});

describe("database newer than the app", () => {
  it("serves health and export but no rpc", async () => {
    const f = join(dir, "kenning.sqlite");
    const db = new DatabaseSync(f);
    db.exec(
      `CREATE TABLE meta (key TEXT, value TEXT); CREATE TABLE events (id TEXT); PRAGMA user_version = ${SCHEMA_VERSION + 5}`,
    );
    db.close();
    await start();
    expect(await fetchServerHealth(base)).toMatchObject({
      state: "schema-too-new",
      foundVersion: SCHEMA_VERSION + 5,
    });
    expect((await rpc("listTexts")).status).toBe(422);
    expect((await fetch(`${base}/api/export`)).status).toBe(200);
    expect((await createHttpAdmin(base).info()).eventCount).toBe(0);
  });
});

import { readFileSync } from "node:fs";
const readFileSyncBytes = (f: string): Buffer => readFileSync(f);
