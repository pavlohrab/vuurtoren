import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "../schema.js";
import { createRepository } from "../repository.js";
import { createNodeSyncDb } from "../node.js";
import { type WorkerLike, createWorkerDriver } from "./driver.js";
import {
  type WorkerRequest,
  type WorkerResponse,
  collectTransferables,
  createRequestHandler,
} from "./protocol.js";

/** Fake worker: runs the real request handler (on node:sqlite) with async message delivery. */
function fakeWorker(persistent: boolean): WorkerLike & { requests: WorkerRequest[] } {
  const file = join(mkdtempSync(join(tmpdir(), "kenning-w-")), "db.sqlite3");
  const handle = createRequestHandler(() =>
    Promise.resolve({
      db: createNodeSyncDb(file),
      persistent,
      exportFile: () => new Uint8Array(readFileSync(file)),
      importFile: (bytes) => {
        writeFileSync(file, bytes);
        return Promise.resolve(createNodeSyncDb(file));
      },
    }),
  );
  const listeners: ((ev: { data: WorkerResponse }) => void)[] = [];
  const requests: WorkerRequest[] = [];
  return {
    requests,
    postMessage(msg) {
      // Structured clone, like a real worker boundary.
      const copy = structuredClone(msg);
      requests.push(copy);
      void handle(copy).then((res) =>
        setTimeout(() => {
          for (const l of listeners) l({ data: structuredClone(res) });
        }, 0),
      );
    },
    addEventListener(type: string, fn: never) {
      if (type === "message") listeners.push(fn);
    },
    terminate() {},
  };
}

describe("web driver message protocol", () => {
  it("opens, reports persistence, round-trips values and uses unique request ids", async () => {
    const w = fakeWorker(false);
    const driver = await createWorkerDriver(w, "t");
    expect(driver.persistent).toBe(false);
    await driver.exec("CREATE TABLE t (a, b, c)");
    const blob = new Uint8Array([1, 2, 3]);
    await driver.exec("INSERT INTO t VALUES (?,?,?)", [blob, 42, null]);
    const rows = await driver.exec("SELECT * FROM t");
    expect(rows[0]).toMatchObject({ b: 42, c: null });
    expect([...(rows[0]!["a"] as Uint8Array)]).toEqual([1, 2, 3]);
    const ids = w.requests.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    await driver.close();
  });

  it("rejects with the worker's error message", async () => {
    const driver = await createWorkerDriver(fakeWorker(true), "t");
    expect(driver.persistent).toBe(true);
    await expect(driver.exec("SELECT * FROM nope")).rejects.toThrow(/no such table/);
  });

  it("handles concurrent requests and rolls transactions back", async () => {
    const driver = await createWorkerDriver(fakeWorker(true), "t");
    await driver.exec("CREATE TABLE n (v INTEGER)");
    await Promise.all([1, 2, 3].map((v) => driver.exec("INSERT INTO n VALUES (?)", [v])));
    await expect(
      driver.transaction(async () => {
        await driver.exec("INSERT INTO n VALUES (99)");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await driver.exec("SELECT count(*) AS c FROM n")).toEqual([{ c: 3 }]);
  });

  it("fails calls after close", async () => {
    const driver = await createWorkerDriver(fakeWorker(true), "t");
    await driver.close();
    await expect(driver.exec("SELECT 1")).rejects.toThrow(/closed/);
  });

  it("terminates synchronously and fails later calls", async () => {
    const w = fakeWorker(true);
    let killed = 0;
    w.terminate = () => {
      killed++;
    };
    const driver = await createWorkerDriver(w, "t");
    driver.terminate();
    driver.terminate();
    expect(killed).toBe(1);
    await expect(driver.exec("SELECT 1")).rejects.toThrow(/terminated/);
  });

  it("runs the full repository over the protocol", async () => {
    const driver = await createWorkerDriver(fakeWorker(true), "t");
    const repo = await createRepository(driver);
    await repo.append({ type: "SettingChanged", key: "k", value: { a: 1 } });
    expect(await repo.setting("k")).toEqual({ a: 1 });
    await repo.close();
  });

  it("collects transferable buffers from rows", () => {
    const u = new Uint8Array([1]);
    expect(collectTransferables([{ a: u, b: 1 }])).toEqual([u.buffer]);
    expect(collectTransferables(null)).toEqual([]);
  });

  describe("export / import", () => {
    it("exports the file and imports it elsewhere with a new device id", async () => {
      const a = await createWorkerDriver(fakeWorker(true), "a");
      const repoA = await createRepository(a);
      await repoA.append({ type: "SettingChanged", key: "k", value: 5 });
      const bytes = await repoA.exclusive(() => a.exportFile());
      expect(Buffer.from(bytes).subarray(0, 15).toString()).toBe("SQLite format 3");

      const b = await createWorkerDriver(fakeWorker(true), "b");
      await b.importFile(bytes);
      const repoB = await createRepository(b);
      expect(repoB.deviceId).not.toBe(repoA.deviceId);
      expect(await repoB.setting("k")).toBe(5);
      expect(await repoB.eventCount()).toBe(1);
    });

    it("keeps cover images (blobs) through the worker and a backup round trip", async () => {
      const a = await createWorkerDriver(fakeWorker(true), "a");
      const repoA = await createRepository(a);
      const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3]);
      const id = await repoA.putBlob(bytes, "image/webp");
      await repoA.append({ type: "TextCoverSet", textId: "t", blobId: id });
      expect(await repoA.getBlob(id)).toEqual({ type: "image/webp", bytes });
      const file = await repoA.exclusive(() => a.exportFile());

      const b = await createWorkerDriver(fakeWorker(true), "b");
      await b.importFile(file);
      const repoB = await createRepository(b);
      expect(await repoB.getBlob(id)).toEqual({ type: "image/webp", bytes });
    });

    it("rejects a non-SQLite file and keeps the current data", async () => {
      const d = await createWorkerDriver(fakeWorker(true), "x");
      const repo = await createRepository(d);
      await repo.append({ type: "SettingChanged", key: "k", value: 1 });
      await expect(d.importFile(new TextEncoder().encode("nope".repeat(50)))).rejects.toThrow(
        /not a SQLite/,
      );
      expect(await repo.setting("k")).toBe(1);
    });

    it("rejects a newer or foreign database and restores the old one", async () => {
      const donor = await createWorkerDriver(fakeWorker(true), "donor");
      await donor.exec("CREATE TABLE other (a)");
      await donor.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      const foreign = await donor.exportFile();
      await donor.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
      const newer = await donor.exportFile();

      const d = await createWorkerDriver(fakeWorker(true), "x");
      const repo = await createRepository(d);
      await repo.append({ type: "SettingChanged", key: "k", value: 1 });
      await expect(d.importFile(newer)).rejects.toThrow(/newer/);
      await expect(d.importFile(foreign)).rejects.toThrow(/not a Kenning backup/);
      expect(await repo.setting("k")).toBe(1);
      await repo.append({ type: "SettingChanged", key: "k", value: 2 });
      expect(await repo.setting("k")).toBe(2);
    });
  });
});
