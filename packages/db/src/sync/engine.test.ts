/** Sync end to end: devices on one place, encrypted files, blobs, folding, a wrong passphrase. */
import { gzipSync } from "fflate";
import { argon2id } from "hash-wasm";
import { describe, expect, it } from "vitest";
import { toBase64 } from "../base64.js";
import { createNodeDriver } from "../node.js";
import { type ImportResult, type KenningRepository, createRepository } from "../repository.js";
import type { SyncEvent } from "../types.js";
import {
  SealedFileError,
  type SyncKey,
  type VaultFile,
  WrongPassphraseError,
  createVault,
  hiddenName,
  keyFromRaw,
  parseRecovery,
  seal,
  unseal,
  vaultId,
} from "./crypto.js";
import {
  NoVaultError,
  VAULT_PATH,
  changeVaultPassphrase,
  listDevices,
  openVault,
  readVault,
  renewRecoveryKey,
  syncOnce,
  toImport,
} from "./engine.js";
import { LIGHT_ARGON2, memoryStore } from "../testing.js";
import type { SyncStore } from "./store.js";

const T0 = Date.UTC(2026, 10, 1, 12);
const PASS = "lange zinnen lezen";

async function device(id: string, start: number) {
  let t = start;
  return createRepository(await createNodeDriver(), { deviceId: id, now: () => t++ });
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe("sync engine", () => {
  it("carries changes, covers and device names between devices, encrypted", async () => {
    const store = memoryStore();
    const a = await device("aaaaaaaaaaaa", T0);
    const b = await device("bbbbbbbbbbbb", T0 + 1000);
    await expect(openVault(store, PASS, false)).rejects.toBeInstanceOf(NoVaultError);
    const keyA = (await openVault(store, PASS, true, LIGHT_ARGON2)).key;
    await expect(openVault(store, "something else", false)).rejects.toBeInstanceOf(
      WrongPassphraseError,
    );
    const keyB = (await openVault(store, PASS, false)).key;

    await a.append({
      type: "TextImported",
      textId: "t1",
      title: "De verloren fiets",
      lang: "nl",
      source: { kind: "paste" },
      content: "Een oude man wijst naar de gracht.",
    });
    const cover = await a.putBlob(PNG, "image/png");
    await a.append({ type: "TextCoverSet", textId: "t1", blobId: cover });
    const first = await syncOnce(a, store, keyA, { deviceName: "Laptop" });
    expect(first).toMatchObject({ sent: 2, received: 0 });

    // Nothing in the place is readable without the key.
    for (const [path, bytes] of store.files) {
      if (path === VAULT_PATH) continue;
      expect(new TextDecoder().decode(bytes)).not.toContain("gracht");
      expect(path).not.toContain(cover);
    }

    const got = await syncOnce(b, store, keyB, { deviceName: "Phone" });
    expect(got).toMatchObject({ sent: 0, received: 2 });
    expect((await b.listTexts()).map((t) => t.title)).toEqual(["De verloren fiets"]);
    expect((await b.getBlob(cover))?.bytes).toEqual(PNG);
    expect(got.devices.map((d) => [d.name, d.self])).toEqual([
      ["Phone", true],
      ["Laptop", false],
    ]);

    // Back the other way; a second sync has nothing to do.
    await b.append({ type: "WordStateSet", lang: "nl", key: "gracht", state: "known" });
    await syncOnce(b, store, keyB, { deviceName: "Phone" });
    expect(await syncOnce(a, store, keyA, { deviceName: "Laptop" })).toMatchObject({
      sent: 0,
      received: 1,
    });
    expect((await a.word("nl", "gracht"))?.state).toBe("known");
    expect(await syncOnce(a, store, keyA, { deviceName: "Laptop" })).toMatchObject({
      sent: 0,
      received: 0,
    });
  });

  it("folds a device's many files into one base; a new device still gets everything", async () => {
    const store = memoryStore();
    const a = await device("aaaaaaaaaaaa", T0);
    const key = (await openVault(store, PASS, true, LIGHT_ARGON2)).key;
    const opts = { deviceName: "Laptop", segmentEvents: 2, foldAfter: 3 };
    for (let i = 0; i < 10; i++) {
      await a.append({ type: "WordStateSet", lang: "nl", key: `w${i}`, state: "known" });
      if (i % 2 === 1) await syncOnce(a, store, key, opts);
    }
    const files = (await store.list("kenning/devices/aaaaaaaaaaaa")).filter(
      (n) => n !== "device.kev",
    );
    expect(files.some((n) => n.endsWith(".base.kev"))).toBe(true);
    expect(files.length).toBeLessThanOrEqual(4);

    const c = await device("cccccccccccc", T0 + 99_000);
    expect(await syncOnce(c, store, key, { deviceName: "Tablet" })).toMatchObject({ received: 10 });
    expect((await c.word("nl", "w9"))?.state).toBe("known");
  });

  it("starts over when the place holds another vault", async () => {
    const store = memoryStore();
    const a = await device("aaaaaaaaaaaa", T0);
    await a.append({ type: "WordStateSet", lang: "nl", key: "x", state: "known" });
    const key = (await openVault(store, PASS, true, LIGHT_ARGON2)).key;
    expect((await syncOnce(a, store, key, { deviceName: "L" })).sent).toBe(1);
    // The place was emptied and set up again: everything goes up again.
    store.files.clear();
    const fresh = (await openVault(store, PASS, true, LIGHT_ARGON2)).key;
    expect((await syncOnce(a, store, fresh, { deviceName: "L" })).sent).toBe(1);
    // The old key no longer opens it.
    await expect(syncOnce(a, store, key, { deviceName: "L" })).rejects.toBeInstanceOf(
      WrongPassphraseError,
    );
  });

  it("ignores what a synced folder adds: markers, temporary files, conflict copies, late files", async () => {
    const store = memoryStore();
    const a = await device("aaaaaaaaaaaa", T0);
    const b = await device("bbbbbbbbbbbb", T0 + 1000);
    const key = (await openVault(store, PASS, true, LIGHT_ARGON2)).key;
    await a.append({ type: "WordStateSet", lang: "nl", key: "x", state: "known" });
    await syncOnce(a, store, key, { deviceName: "Laptop" });
    const junk = new Uint8Array([1, 2, 3]);
    await store.put(".stfolder/.keep", junk);
    await store.put("kenning/devices/.stfolder", junk);
    const [seg] = (await store.list("kenning/devices/aaaaaaaaaaaa")).filter(
      (n) => n.endsWith(".kev") && n !== "device.kev",
    );
    await store.put(`kenning/devices/aaaaaaaaaaaa/.syncthing.${seg}.tmp`, junk);
    await store.put(
      `kenning/devices/aaaaaaaaaaaa/${seg!.replace(".kev", ".sync-conflict-20261120-120000-ABCDEFG.kev")}`,
      junk,
    );
    const got = await syncOnce(b, store, key, { deviceName: "Phone" });
    expect(got.received).toBe(1);
    expect(got.devices.map((d) => d.name)).toEqual(["Phone", "Laptop"]);
    // A segment listed before it has arrived (still being copied) comes next time.
    await a.append({ type: "WordStateSet", lang: "nl", key: "y", state: "known" });
    await syncOnce(a, store, key, { deviceName: "Laptop" });
    const real = store.get.bind(store);
    store.get = async (path) =>
      path.endsWith(".kev") && !path.endsWith("device.kev") ? null : real(path);
    expect((await syncOnce(b, store, key, { deviceName: "Phone" })).received).toBe(0);
    store.get = real;
    expect((await syncOnce(b, store, key, { deviceName: "Phone" })).received).toBe(1);
  });

  it("reads the files after the cursor in order, a segment before a part that ends with it", () => {
    const id = (n: number) => `01J${String(n).padStart(23, "0")}`;
    const names = [
      `${id(1)}.kev`,
      `${id(2)}.base.kev`,
      `${id(2)}.kev`,
      `${id(3)}.kev`,
      "device.kev",
      "notes.txt",
    ];
    expect(toImport(names, "")).toEqual([
      `${id(1)}.kev`,
      `${id(2)}.kev`,
      `${id(2)}.base.kev`,
      `${id(3)}.kev`,
    ]);
    expect(toImport(names, id(2))).toEqual([`${id(3)}.kev`]);
  });
});

describe("sync crypto", () => {
  it("seals and opens, names blobs without revealing them, refuses other keys", async () => {
    const { key, vault } = await createVault(PASS, LIGHT_ARGON2);
    expect(vault).toMatchObject({
      format: 2,
      locks: [{ kind: "passphrase", kdf: { name: "argon2id" } }, { kind: "recovery" }],
    });
    const sealed = await seal(key, new TextEncoder().encode("hallo"));
    expect(new TextDecoder().decode(await unseal(key, sealed))).toBe("hallo");
    const other = await keyFromRaw(new Uint8Array(64).fill(7));
    await expect(unseal(other, sealed)).rejects.toBeInstanceOf(SealedFileError);
    expect(await hiddenName(key, "abc")).toBe(await hiddenName(key, "abc"));
    expect(await hiddenName(key, "abc")).not.toBe(await hiddenName(other, "abc"));
    // The remembered key opens what the passphrase sealed.
    expect(new TextDecoder().decode(await unseal(await keyFromRaw(key.raw), sealed))).toBe("hallo");
    await expect(createVault("short")).rejects.toThrow(/8 characters/);
  });

  it("opens with the recovery key, written any way, and the passphrase changes without touching files", async () => {
    const store = memoryStore();
    const a = await device("aaaaaaaaaaaa", T0);
    const made = await openVault(store, PASS, true, LIGHT_ARGON2);
    expect(made.recoveryKey).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
    await a.append({ type: "WordStateSet", lang: "nl", key: "x", state: "known" });
    await syncOnce(a, store, made.key, { deviceName: "Laptop" });
    const before = new Map(store.files);

    const sloppy = made.recoveryKey!.toLowerCase().replace(/-/g, " ");
    expect((await openVault(store, sloppy, false)).key.raw).toEqual(made.key.raw);

    await changeVaultPassphrase(store, made.key, "een nieuwe zin", LIGHT_ARGON2);
    await expect(openVault(store, PASS, false)).rejects.toBeInstanceOf(WrongPassphraseError);
    expect((await openVault(store, "een nieuwe zin", false)).key.raw).toEqual(made.key.raw);
    // The recovery key still works, no synced file changed, devices keep their key.
    expect((await openVault(store, made.recoveryKey!, false)).key.raw).toEqual(made.key.raw);
    for (const [path, bytes] of before)
      if (path !== VAULT_PATH) expect(store.files.get(path)).toEqual(bytes);
    expect(await syncOnce(a, store, made.key, { deviceName: "Laptop" })).toMatchObject({ sent: 0 });

    // A new recovery key: the old one stops working.
    const fresh = await renewRecoveryKey(store, made.key, LIGHT_ARGON2);
    await expect(openVault(store, made.recoveryKey!, false)).rejects.toBeInstanceOf(
      WrongPassphraseError,
    );
    expect((await openVault(store, fresh, false)).key.raw).toEqual(made.key.raw);
    expect(parseRecovery("not a key")).toBeNull();
  });

  it("still opens a vault of the first format, and upgrades it on a passphrase change", async () => {
    // A first-format vault: the key is the passphrase's PBKDF2 output.
    const salt = new Uint8Array(16).fill(3);
    const base = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(PASS),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const raw = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "PBKDF2", hash: "SHA-256", salt, iterations: 1000 },
        base,
        512,
      ),
    );
    const key = await keyFromRaw(raw);
    const old: VaultFile = {
      format: 1,
      kdf: { name: "PBKDF2-SHA256", iterations: 1000, salt: toBase64(salt) },
      check: toBase64(await seal(key, new TextEncoder().encode("kenning-sync"))),
    };
    const store = memoryStore();
    await store.put(VAULT_PATH, new TextEncoder().encode(JSON.stringify(old)));
    expect((await openVault(store, PASS, false)).key.raw).toEqual(raw);
    await expect(renewRecoveryKey(store, key, LIGHT_ARGON2)).rejects.toThrow(/passphrase first/);
    await changeVaultPassphrase(store, key, "een nieuwe zin", LIGHT_ARGON2);
    expect((await openVault(store, "een nieuwe zin", false)).key.raw).toEqual(raw);
    // Same vault for the devices' sync state.
    const vault = JSON.parse(new TextDecoder().decode((await store.get(VAULT_PATH))!)) as VaultFile;
    expect(vaultId(vault)).toBe(vaultId(old));
    expect(await renewRecoveryKey(store, key, LIGHT_ARGON2)).toMatch(/-/);
  });
});

const A = "aaaaaaaaaaaa";
const B = "bbbbbbbbbbbb";
const C = "cccccccccccc";
const dirOf = (id: string) => `kenning/devices/${id}`;
const eventFiles = async (store: SyncStore, id: string) =>
  (await store.list(dirOf(id))).filter((n) => n !== "device.kev");

/** A store that counts what is asked of it. */
function counted(store: ReturnType<typeof memoryStore>) {
  const calls: string[] = [];
  const counting: SyncStore = {
    label: store.label,
    list: (dir) => (calls.push(`list ${dir}`), store.list(dir)),
    get: (path) => (calls.push(`get ${path}`), store.get(path)),
    put: (path, bytes) => (calls.push(`put ${path}`), store.put(path, bytes)),
    remove: (path) => (calls.push(`remove ${path}`), store.remove(path)),
  };
  return { calls, store: counting };
}

/** A file as the first version of sync wrote it: no range, sealed without its path. */
async function firstFormatFile(key: SyncKey, device: string, events: SyncEvent[]) {
  const json = new TextEncoder().encode(JSON.stringify({ format: 1, device, events }));
  return seal(key, gzipSync(json));
}

const mark = (repo: KenningRepository, key: string) =>
  repo.append({ type: "WordStateSet", lang: "nl", key, state: "known" });

describe("sync engine, when things go wrong", () => {
  it("brings in many files with one replay", async () => {
    const store = memoryStore();
    const key = (await openVault(store, PASS, true, LIGHT_ARGON2)).key;
    const a = await device(A, T0);
    const b = await device(B, T0 + 50_000);
    for (let i = 0; i < 4; i++) await mark(a, `a${i}`);
    await syncOnce(a, store, key, { deviceName: "Laptop", segmentEvents: 1 });
    expect(await eventFiles(store, A)).toHaveLength(4);
    // B's own change is newer than all of A's: A's events land before the log's end.
    await b.append({ type: "WordStateSet", lang: "nl", key: "a0", state: "learning" });
    const results: ImportResult[] = [];
    const real = b.importEvents.bind(b);
    b.importEvents = async (events, opts) => {
      const r = await real(events, opts);
      results.push(r);
      return r;
    };
    const got = await syncOnce(b, store, key, { deviceName: "Phone" });
    expect(got).toMatchObject({ received: 4, rebuilt: true });
    expect(results.filter((r) => r.rebuilt)).toHaveLength(1);
    expect((await b.word("nl", "a0"))?.state).toBe("learning");
    expect((await b.word("nl", "a3"))?.state).toBe("known");
  });

  it("caps segments by size", async () => {
    const store = memoryStore();
    const key = (await openVault(store, PASS, true, LIGHT_ARGON2)).key;
    const a = await device(A, T0);
    for (let i = 0; i < 5; i++) {
      await a.append({
        type: "TextImported",
        textId: `t${i}`,
        title: `Tekst ${i}`,
        lang: "nl",
        source: { kind: "paste" },
        content: "Een zin over de gracht. ".repeat(100),
      });
    }
    await syncOnce(a, store, key, { deviceName: "Laptop", segmentBytes: 5000 });
    expect((await eventFiles(store, A)).length).toBeGreaterThanOrEqual(3);
    const b = await device(B, T0 + 50_000);
    expect(await syncOnce(b, store, key, { deviceName: "Phone" })).toMatchObject({ received: 5 });
  });

  it("folds only what is new; a device that keeps up never downloads a folded part", async () => {
    const base = memoryStore();
    const { store, calls } = counted(base);
    const key = (await openVault(store, PASS, true, LIGHT_ARGON2)).key;
    const a = await device(A, T0);
    const b = await device(B, T0 + 500_000);
    const opts = { deviceName: "Laptop", foldAfter: 3, baseBytes: 1 };
    const early = new Map<string, Uint8Array>();
    for (let i = 0; i < 12; i++) {
      await mark(a, `w${i}`);
      await syncOnce(a, store, key, opts);
      await syncOnce(b, store, key, { deviceName: "Phone" });
      if (i === 5) {
        for (const n of await eventFiles(base, A)) {
          if (n.endsWith(".base.kev")) early.set(n, base.files.get(`${dirOf(A)}/${n}`)!);
        }
      }
    }
    // The first fold's parts are still there, unchanged: later folds added to them.
    expect(early.size).toBeGreaterThan(0);
    for (const [n, bytes] of early) expect(base.files.get(`${dirOf(A)}/${n}`)).toEqual(bytes);
    const segs = (await eventFiles(base, A)).filter((n) => !n.endsWith(".base.kev"));
    expect(segs.length).toBeLessThanOrEqual(4);
    const partReads = calls.filter(
      (c) => c.startsWith(`get ${dirOf(A)}`) && c.endsWith(".base.kev"),
    );
    expect(partReads).toEqual([]);
    expect((await b.word("nl", "w11"))?.state).toBe("known");
    // A new device reads the parts and the segments after them.
    const c = await device(C, T0 + 900_000);
    expect(await syncOnce(c, base, key, { deviceName: "Tablet" })).toMatchObject({ received: 12 });
  });

  it("leaves out a file that never opens, after a few tries, and goes on", async () => {
    const store = memoryStore();
    const key = (await openVault(store, PASS, true, LIGHT_ARGON2)).key;
    const a = await device(A, T0);
    const c = await device(C, T0 + 1);
    await mark(a, "eerste");
    await syncOnce(a, store, key, { deviceName: "Laptop" });
    await mark(a, "tweede");
    await syncOnce(a, store, key, { deviceName: "Laptop" });
    await mark(c, "derde");
    await syncOnce(c, store, key, { deviceName: "Tablet" });
    const [first] = await eventFiles(store, A);
    const path = `${dirOf(A)}/${first}`;
    store.files.set(path, new TextEncoder().encode("KSY2 this is not what was written"));

    const b = await device(B, T0 + 50_000);
    for (let i = 0; i < 2; i++) {
      const r = await syncOnce(b, store, key, { deviceName: "Phone" });
      // The other device's changes still come.
      expect(r.received).toBe(i === 0 ? 1 : 0);
      expect(r.problems).toEqual([expect.objectContaining({ what: path, leftOut: false })]);
    }
    const r = await syncOnce(b, store, key, { deviceName: "Phone" });
    expect(r.problems).toEqual([expect.objectContaining({ what: path, leftOut: true })]);
    expect(r.received).toBe(1);
    expect((await b.word("nl", "tweede"))?.state).toBe("known");
    expect(await b.word("nl", "eerste")).toBeNull();
    expect(await b.syncState()).toMatchObject({ problems: [{ what: path, leftOut: true }] });
    expect((await syncOnce(b, store, key, { deviceName: "Phone" })).problems).toEqual([]);
  });

  it("binds files to their path; files of the first format still open", async () => {
    const store = memoryStore();
    const key = (await openVault(store, PASS, true, LIGHT_ARGON2)).key;
    const a = await device(A, T0);
    await mark(a, "eerste");
    const old = await a.exportEvents();
    // A first-format file, named by its last event id.
    await store.put(`${dirOf(A)}/${old[0]!.id}.kev`, await firstFormatFile(key, A, old));
    const b = await device(B, T0 + 50_000);
    expect(await syncOnce(b, store, key, { deviceName: "Phone" })).toMatchObject({ received: 1 });

    // A current file copied into another device's folder does not open there.
    await mark(a, "tweede");
    const vault = vaultId((await readVault(store))!);
    await a.setSyncState({ vault, sent: old[0]!.id, received: {} });
    await syncOnce(a, store, key, { deviceName: "Laptop" });
    const [, name] = await eventFiles(store, A);
    await store.put(`${dirOf(C)}/${name}`, (await store.get(`${dirOf(A)}/${name}`))!);
    const r = await syncOnce(b, store, key, { deviceName: "Phone" });
    expect(r.received).toBe(1);
    expect(r.problems).toEqual([
      expect.objectContaining({
        what: `${dirOf(C)}/${name}`,
        error: expect.stringMatching(/moved/),
      }),
    ]);

    // A first-format file under a name that is not its last event's id is refused.
    const D = "dddddddddddd";
    const d = await device(D, T0 + 2);
    await mark(d, "vierde");
    const fake = `${"7".padEnd(26, "0")}.kev`;
    await store.put(`${dirOf(D)}/${fake}`, await firstFormatFile(key, D, await d.exportEvents()));
    expect((await syncOnce(b, store, key, { deviceName: "Phone" })).problems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          what: `${dirOf(D)}/${fake}`,
          error: expect.stringMatching(/name says/),
        }),
      ]),
    );
  });

  it("refuses a file that unpacks to more than it may", async () => {
    const store = memoryStore();
    const key = (await openVault(store, PASS, true, LIGHT_ARGON2)).key;
    const path = `${dirOf(A)}/01JAAAAAAAAAAAAAAAAAAAAAAA.kev`;
    await store.put(path, await seal(key, gzipSync(new Uint8Array(70 * 1024 * 1024)), path));
    const b = await device(B, T0 + 50_000);
    expect((await syncOnce(b, store, key, { deviceName: "Phone" })).problems).toEqual([
      expect.objectContaining({ what: path, error: expect.stringMatching(/more than/) }),
    ]);
  });

  it("waits for a file that has not arrived before taking the ones after it", async () => {
    const store = memoryStore();
    const key = (await openVault(store, PASS, true, LIGHT_ARGON2)).key;
    const a = await device(A, T0);
    await mark(a, "eerste");
    await syncOnce(a, store, key, { deviceName: "Laptop" });
    await mark(a, "tweede");
    await syncOnce(a, store, key, { deviceName: "Laptop" });
    const [first] = await eventFiles(store, A);
    const path = `${dirOf(A)}/${first}`;
    const bytes = (await store.get(path))!;
    await store.remove(path);
    const b = await device(B, T0 + 50_000);
    expect((await syncOnce(b, store, key, { deviceName: "Phone" })).received).toBe(0);
    await store.put(path, bytes);
    expect((await syncOnce(b, store, key, { deviceName: "Phone" })).received).toBe(2);
    expect(await b.syncState()).toMatchObject({ retries: {} });
  });

  it("writes its name when it sent something or an hour passed; lists blobs only when needed", async () => {
    const { store, calls } = counted(memoryStore());
    const key = (await openVault(store, PASS, true, LIGHT_ARGON2)).key;
    const a = await device(A, T0);
    let t = T0;
    const opts = { deviceName: "L".repeat(500), now: () => t };
    await a.append({
      type: "TextImported",
      textId: "t1",
      title: "Fiets",
      lang: "nl",
      source: { kind: "paste" },
      content: "Een fiets.",
    });
    const cover = await a.putBlob(PNG, "image/png");
    await a.append({ type: "TextCoverSet", textId: "t1", blobId: cover });
    await syncOnce(a, store, key, opts);
    const named = () => calls.filter((c) => c === `put ${dirOf(A)}/device.kev`).length;
    const blobLists = () => calls.filter((c) => c === "list kenning/blobs").length;
    expect([named(), blobLists()]).toEqual([1, 1]);
    await syncOnce(a, store, key, opts);
    expect(named()).toBe(1);
    // The same cover again: known to be there, so blobs are not listed.
    await a.append({ type: "TextCoverSet", textId: "t1", blobId: cover });
    await syncOnce(a, store, key, opts);
    expect([named(), blobLists()]).toEqual([2, 1]);
    t += 2 * 3_600_000;
    await syncOnce(a, store, key, opts);
    expect(named()).toBe(3);
    // Names stay short.
    const [self] = await listDevices(store, key, A);
    expect(self!.name).toHaveLength(64);
  });

  it("asks only for blobs with a real id", async () => {
    const store = memoryStore();
    const key = (await openVault(store, PASS, true, LIGHT_ARGON2)).key;
    const a = await device(A, T0);
    await a.append({ type: "TextCoverSet", textId: "t1", blobId: "../../vault.json" });
    await syncOnce(a, store, key, { deviceName: "Laptop" });
    const b = await device(B, T0 + 50_000);
    expect(await syncOnce(b, store, key, { deviceName: "Phone" })).toMatchObject({ received: 1 });
    expect(await b.syncState()).toMatchObject({ missing: {} });
  });
});

describe("sync vault", () => {
  it("refuses a vault.json that asks too much or is not one", async () => {
    const store = memoryStore();
    const { vault } = await createVault(PASS, LIGHT_ARGON2);
    const put = (v: unknown) => store.put(VAULT_PATH, new TextEncoder().encode(JSON.stringify(v)));
    const v2 = vault as Extract<VaultFile, { format: 2 }>;
    await put({
      ...v2,
      locks: v2.locks.map((l) => ({ ...l, kdf: { ...l.kdf, memoryKiB: 4_000_000_000 } })),
    });
    await expect(openVault(store, PASS, false)).rejects.toThrow(/cannot use/);
    await put({
      format: 1,
      kdf: { name: "PBKDF2-SHA256", iterations: 1e9, salt: "AAAA" },
      check: "AAAA",
    });
    await expect(openVault(store, PASS, false)).rejects.toThrow(/cannot use/);
    await store.put(VAULT_PATH, new TextEncoder().encode("not json"));
    await expect(openVault(store, PASS, false)).rejects.toThrow(/cannot use/);
    await put({ format: 3 });
    await expect(openVault(store, PASS, false)).rejects.toThrow(/newer Kenning/);
  });

  it("never mixes up a passphrase and a recovery key", async () => {
    const odd = "abcd efgh jkmn pqrs tvwx yz01 2345 6789";
    await expect(createVault(odd, LIGHT_ARGON2)).rejects.toThrow(/recovery key/);
    // A vault from before such passphrases were refused: its passphrase lock opens with it.
    const made = await createVault(PASS, LIGHT_ARGON2);
    const vault = made.vault as Extract<VaultFile, { format: 2 }>;
    const salt = new Uint8Array(16).fill(5);
    const lockKey = await keyFromRaw(
      await argon2id({
        password: odd,
        salt,
        parallelism: 1,
        iterations: 1,
        memorySize: 64,
        hashLength: 64,
        outputType: "binary",
      }),
    );
    const locks = [
      {
        kind: "passphrase",
        kdf: { name: "argon2id", salt: toBase64(salt), ...LIGHT_ARGON2 },
        sealed: toBase64(await seal(lockKey, made.key.raw)),
      },
      ...vault.locks.filter((l) => l.kind === "recovery"),
    ];
    const store = memoryStore();
    await store.put(VAULT_PATH, new TextEncoder().encode(JSON.stringify({ ...vault, locks })));
    expect((await openVault(store, odd, false)).key.raw).toEqual(made.key.raw);
    expect((await openVault(store, made.recoveryKey, false)).key.raw).toEqual(made.key.raw);
  });

  it("takes the passphrase without the spaces around it", async () => {
    const store = memoryStore();
    const made = await openVault(store, `  ${PASS} `, true, LIGHT_ARGON2);
    expect((await openVault(store, PASS, false)).key.raw).toEqual(made.key.raw);
    expect((await openVault(store, `${PASS}\n`, false)).key.raw).toEqual(made.key.raw);
  });
});
