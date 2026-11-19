/** Sync end to end: devices on one place, encrypted files, blobs, folding, a wrong passphrase. */
import { describe, expect, it } from "vitest";
import { createNodeDriver } from "../node.js";
import { createRepository } from "../repository.js";
import {
  SealedFileError,
  WrongPassphraseError,
  createVault,
  hiddenName,
  keyFromRaw,
  seal,
  unseal,
} from "./crypto.js";
import { NoVaultError, VAULT_PATH, openVault, syncOnce, toImport } from "./engine.js";
import { memoryStore } from "./store.js";

const T0 = Date.UTC(2026, 10, 1, 12);
const PASS = "lange zinnen lezen";
const ITER = 1000;

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
    const keyA = await openVault(store, PASS, true, ITER);
    await expect(openVault(store, "something else", false)).rejects.toBeInstanceOf(
      WrongPassphraseError,
    );
    const keyB = await openVault(store, PASS, false);

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
    const key = await openVault(store, PASS, true, ITER);
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
    const key = await openVault(store, PASS, true, ITER);
    expect((await syncOnce(a, store, key, { deviceName: "L" })).sent).toBe(1);
    // The place was emptied and set up again: everything goes up again.
    store.files.clear();
    const fresh = await openVault(store, PASS, true, ITER);
    expect((await syncOnce(a, store, fresh, { deviceName: "L" })).sent).toBe(1);
    // The old key no longer opens it.
    await expect(syncOnce(a, store, key, { deviceName: "L" })).rejects.toBeInstanceOf(
      WrongPassphraseError,
    );
  });

  it("imports the newest base and the files after it", () => {
    const id = (n: number) => `01J${String(n).padStart(23, "0")}`;
    const names = [
      `${id(1)}.kev`,
      `${id(2)}.kev`,
      `${id(3)}.base.kev`,
      `${id(4)}.kev`,
      "device.kev",
    ];
    expect(toImport(names, "")).toEqual([`${id(3)}.base.kev`, `${id(4)}.kev`]);
    expect(toImport(names, id(3))).toEqual([`${id(4)}.kev`]);
    expect(toImport(names, id(1))).toEqual([`${id(3)}.base.kev`, `${id(4)}.kev`]);
  });
});

describe("sync crypto", () => {
  it("seals and opens, names blobs without revealing them, refuses other keys", async () => {
    const { key, vault } = await createVault(PASS, ITER);
    expect(vault.kdf.iterations).toBe(ITER);
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
});
