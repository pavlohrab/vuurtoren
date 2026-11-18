import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inspectBackup, prepareImported } from "./backup.js";
import { createNodeSyncDb } from "./node.js";
import {
  type NativeDb,
  createNativeDriver,
  decodeRow,
  decodeValue,
  encodeParam,
} from "./native.js";
import { createRepository } from "./repository.js";
import { SCHEMA_VERSION } from "./schema.js";
import type { SqlValue } from "./types.js";

/** Encode a row the way the Rust side does (db.rs `to_json`). */
function rustJson(row: Record<string, SqlValue>): unknown {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Uint8Array) out[k] = { $b: Buffer.from(v).toString("base64") };
    else if (typeof v === "bigint")
      out[k] = v > BigInt(Number.MAX_SAFE_INTEGER) ? { $i: v.toString() } : Number(v);
    else out[k] = v;
  }
  return out;
}

/** Rust's parameter decoding (db.rs `to_value`). */
function rustParam(v: unknown): SqlValue {
  if (v && typeof v === "object") {
    const o = v as { $b?: string; $i?: string };
    if (o.$b !== undefined) return new Uint8Array(Buffer.from(o.$b, "base64"));
    if (o.$i !== undefined) return BigInt(o.$i);
  }
  return v as SqlValue;
}

/** A stand-in for the app: node:sqlite on a file, with a JSON round trip like the IPC. */
function fakeApp(): NativeDb & { file: string; calls: number } {
  const file = join(mkdtempSync(join(tmpdir(), "kenning-native-")), "kenning.sqlite");
  let db = createNodeSyncDb(file);
  const app = {
    file,
    calls: 0,
    exec(sql: string, params: unknown[]) {
      app.calls++;
      const wire = JSON.parse(JSON.stringify(params)) as unknown[];
      const rows = db.exec(sql, wire.map(rustParam));
      return Promise.resolve(JSON.parse(JSON.stringify(rows.map(rustJson))) as unknown[]);
    },
    close() {
      db.close();
      return Promise.resolve();
    },
    exportFile() {
      return Promise.resolve(new Uint8Array(readFileSync(file)).buffer);
    },
    importFile(bytes: Uint8Array, deviceId: string, maxSchema: number) {
      expect(maxSchema).toBe(SCHEMA_VERSION);
      db.close();
      writeFileSync(file, bytes);
      db = createNodeSyncDb(file);
      inspectBackup(db);
      prepareImported(db, deviceId);
      return Promise.resolve();
    },
  };
  return app;
}

describe("native driver encoding", () => {
  it("round-trips blobs and big integers", () => {
    const blob = new Uint8Array([0, 1, 2, 250, 255]);
    expect(decodeValue(encodeParam(blob))).toEqual(blob);
    expect(encodeParam(12n)).toBe(12);
    expect(decodeValue(encodeParam(2n ** 60n))).toBe(2n ** 60n);
    expect(encodeParam("x")).toBe("x");
    expect(encodeParam(null)).toBeNull();
    expect(decodeRow({ a: 1, b: true, c: null })).toEqual({ a: 1, b: 1, c: null });
    expect(() => decodeValue([1])).toThrow(/Unexpected value/);
  });

  it("encodes large blobs in chunks", () => {
    const big = new Uint8Array(200_000).map((_, i) => i % 251);
    expect(decodeValue(encodeParam(big))).toEqual(big);
  });
});

describe("native driver with the shared repository", () => {
  it("runs migrations, events and projections like the browser worker", async () => {
    const app = fakeApp();
    const driver = createNativeDriver(app);
    const repo = await createRepository(driver);
    await repo.append({ type: "SettingChanged", key: "settings", value: { lang: "nl" } });
    expect(await repo.setting("settings")).toEqual({ lang: "nl" });
    const rows = await driver.exec("SELECT ? AS b, ? AS n", [new Uint8Array([7, 8]), 5n]);
    expect(rows[0]).toEqual({ b: new Uint8Array([7, 8]), n: 5 });
    await driver.close();

    // Reopen the same file: the data is there.
    const again = createNativeDriver(fakeAppOn(app.file));
    const repo2 = await createRepository(again);
    expect(await repo2.setting("settings")).toEqual({ lang: "nl" });
    await again.close();
  });

  it("rolls back a failed transaction", async () => {
    const driver = createNativeDriver(fakeApp());
    await driver.exec("CREATE TABLE t (x)");
    await expect(
      driver.transaction(async () => {
        await driver.exec("INSERT INTO t VALUES (1)");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await driver.exec("SELECT count(*) AS n FROM t")).toEqual([{ n: 0 }]);
  });

  it("exports a backup and imports it with a new device id; rejects non-backups", async () => {
    const app = fakeApp();
    const driver = createNativeDriver(app);
    const repo = await createRepository(driver);
    await repo.append({ type: "SettingChanged", key: "k", value: 1 });
    const bytes = await driver.exportFile();
    expect(bytes).toBeInstanceOf(Uint8Array);
    await driver.importFile(bytes);
    const [row] = await driver.exec("SELECT value FROM meta WHERE key = 'device_id'");
    expect(JSON.parse(String(row?.["value"]))).not.toBe(repo.deviceId);
    await expect(driver.importFile(new Uint8Array(200))).rejects.toThrow(/not a SQLite/);
  });

  it("turns app errors (strings) into Errors", async () => {
    const driver = createNativeDriver({
      ...fakeApp(),
      exec: () => Promise.reject("no such table: nope"),
    });
    await expect(driver.exec("SELECT * FROM nope")).rejects.toThrow("no such table: nope");
  });
});

function fakeAppOn(file: string): NativeDb {
  const db = createNodeSyncDb(file);
  return {
    exec: (sql, params) =>
      Promise.resolve(
        JSON.parse(
          JSON.stringify(db.exec(sql, (params as unknown[]).map(rustParam)).map(rustJson)),
        ) as unknown[],
      ),
    close: () => Promise.resolve(db.close()),
    exportFile: () => Promise.resolve(new Uint8Array(readFileSync(file))),
    importFile: () => Promise.reject(new Error("not used")),
  };
}
