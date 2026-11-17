import { describe, expect, it } from "vitest";
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
  const handle = createRequestHandler(() =>
    Promise.resolve({ db: createNodeSyncDb(":memory:"), persistent }),
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
});
