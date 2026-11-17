import { describe, expect, it } from "vitest";
import { contentHash, sha256Bytes } from "./hash.js";
import {
  compareHlc,
  createHlc,
  createUlidGenerator,
  formatHlc,
  parseHlc,
  randomDeviceId,
  ulidTime,
} from "./ids.js";

describe("ULID", () => {
  it("is 26 chars of Crockford base32 and encodes the time", () => {
    const next = createUlidGenerator(() => 1_700_000_000_000);
    const id = next();
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(ulidTime(id)).toBe(1_700_000_000_000);
  });

  it("is strictly increasing within one millisecond", () => {
    const next = createUlidGenerator(() => 5);
    const ids = Array.from({ length: 1000 }, next);
    for (let i = 1; i < ids.length; i++) expect(ids[i]! > ids[i - 1]!).toBe(true);
  });

  it("stays sortable across ms and when the clock goes backwards", () => {
    const times = [10, 10, 11, 9, 9, 20];
    let i = 0;
    const next = createUlidGenerator(() => times[i++]!);
    const ids = times.map(() => next());
    expect([...ids].sort()).toEqual(ids);
  });

  it("throws when the random part overflows", () => {
    const next = createUlidGenerator(
      () => 1,
      () => new Uint8Array(16).fill(31),
    );
    expect(() => next()).not.toThrow();
    expect(() => next()).toThrow(/overflow/);
  });

  it("can resume after an existing id", () => {
    const first = createUlidGenerator(() => 7)();
    const next = createUlidGenerator(() => 7, undefined, first);
    expect(next() > first).toBe(true);
  });

  it("random device ids have no dash", () => {
    expect(randomDeviceId()).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("HLC", () => {
  it("has format <ms>-<counter>-<device> and round-trips", () => {
    const s = formatHlc({ ms: 123, counter: 4, deviceId: "dev" });
    expect(s.endsWith("-dev")).toBe(true);
    expect(parseHlc(s)).toEqual({ ms: 123, counter: 4, deviceId: "dev" });
  });

  it("tick is strictly monotonic, even with a frozen or backwards clock", () => {
    const times = [100, 100, 100, 50, 200];
    let i = 0;
    const hlc = createHlc("a", () => times[i++]!);
    const ticks = times.map(() => hlc.tick());
    for (let k = 1; k < ticks.length; k++)
      expect(compareHlc(ticks[k - 1]!, ticks[k]!)).toBeLessThan(0);
    expect(parseHlc(ticks[4]!).counter).toBe(0);
  });

  it("receive moves the clock past a remote timestamp", () => {
    const hlc = createHlc("a", () => 100);
    const remote = formatHlc({ ms: 500, counter: 7, deviceId: "b" });
    const merged = hlc.receive(remote);
    expect(compareHlc(merged, remote)).toBeGreaterThan(0);
    expect(compareHlc(hlc.tick(), merged)).toBeGreaterThan(0);
  });

  it("orders by ms, then counter, then device, and string order agrees", () => {
    const a = formatHlc({ ms: 9, counter: 1, deviceId: "z" });
    const b = formatHlc({ ms: 10, counter: 0, deviceId: "a" });
    const c = formatHlc({ ms: 10, counter: 1, deviceId: "a" });
    const d = formatHlc({ ms: 10, counter: 1, deviceId: "b" });
    const sorted = [a, b, c, d];
    expect([...sorted].reverse().sort(compareHlc)).toEqual(sorted);
    expect([...sorted].reverse().sort()).toEqual(sorted);
  });

  it("can resume from persisted state", () => {
    const hlc = createHlc("a", () => 100, formatHlc({ ms: 300, counter: 2, deviceId: "a" }));
    expect(parseHlc(hlc.tick())).toMatchObject({ ms: 300, counter: 3 });
  });

  it("rejects malformed input", () => {
    expect(() => parseHlc("nope")).toThrow();
  });
});

describe("SHA-256", () => {
  it("matches known vectors", () => {
    expect(contentHash("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(contentHash("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(contentHash("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("agrees with node:crypto on random and unicode data", async () => {
    const { createHash } = await import("node:crypto");
    for (const s of [
      "één woord — ¿qué? 日本語 🎉",
      "x".repeat(55),
      "x".repeat(56),
      "x".repeat(64),
      "y".repeat(1000),
    ]) {
      expect(contentHash(s)).toBe(createHash("sha256").update(s).digest("hex"));
    }
    expect(sha256Bytes(new Uint8Array([1, 2, 3]))).toBe(
      createHash("sha256")
        .update(new Uint8Array([1, 2, 3]))
        .digest("hex"),
    );
  });
});
