/**
 * The places behind fake servers: the same behaviour from each, and two devices syncing
 * through each with the real engine.
 */
import { describe, expect, it } from "vitest";
import { type SyncStore, createRepository, openVault, syncOnce } from "@app/db";
import { createNodeDriver } from "@app/db/node";
import { LIGHT_ARGON2 } from "@app/db/testing";
import { propfindNames, webdavStore } from "./webdavStore.js";
import { serverStore } from "./serverStore.js";
import { fakeDav, fakeServer } from "./fake-places.test-util.js";

const places: [string, () => SyncStore][] = [
  [
    "Vuurtoren server",
    () => serverStore("https://vuurtoren.example/", "ksync_t", fakeServer(new Map(), "ksync_t")),
  ],
  [
    "WebDAV",
    () =>
      webdavStore(
        "https://dav.example/files/anna",
        "anna",
        "app-password",
        fakeDav(new Map(), new Set()),
      ),
  ],
];

describe.each(places)("%s", (_name, make) => {
  it("lists, reads, writes, replaces and removes files", async () => {
    const store = make();
    expect(await store.list("vuurtoren/devices")).toEqual([]);
    expect(await store.get("vuurtoren/vault.json")).toBeNull();
    await store.put("vuurtoren/devices/abc/1.kev", new Uint8Array([1, 2]));
    await store.put("vuurtoren/devices/abc/1.kev", new Uint8Array([3]));
    await store.put("vuurtoren/devices/def/2.kev", new Uint8Array([4]));
    expect(await store.list("vuurtoren/devices")).toEqual(["abc", "def"]);
    expect(await store.list("vuurtoren/devices/abc")).toEqual(["1.kev"]);
    expect(await store.get("vuurtoren/devices/abc/1.kev")).toEqual(new Uint8Array([3]));
    await store.remove("vuurtoren/devices/abc/1.kev");
    await store.remove("vuurtoren/devices/abc/1.kev");
    expect(await store.get("vuurtoren/devices/abc/1.kev")).toBeNull();
  });

  it("carries two devices' changes with the sync engine", async () => {
    const store = make();
    const a = await createRepository(await createNodeDriver(), { deviceId: "aaaaaaaaaaaa" });
    const b = await createRepository(await createNodeDriver(), { deviceId: "bbbbbbbbbbbb" });
    const key = (await openVault(store, "lange zinnen lezen", true, LIGHT_ARGON2)).key;
    await a.append({ type: "WordStateSet", lang: "nl", key: "fiets", state: "known" });
    await syncOnce(a, store, key, { deviceName: "Laptop" });
    expect(await syncOnce(b, store, key, { deviceName: "Phone" })).toMatchObject({ received: 1 });
    expect((await b.word("nl", "fiets"))?.state).toBe("known");
  });
});

describe("a Vuurtoren server", () => {
  it("never asks the browser cache", async () => {
    const caches: (RequestCache | undefined)[] = [];
    const fake = fakeServer(new Map(), "ksync_t");
    const store = serverStore("https://vuurtoren.example", "ksync_t", (async (input, init) => {
      caches.push(init?.cache);
      return fake(input, init);
    }) as typeof fetch);
    await store.put("vuurtoren/blobs/a.kbl", new Uint8Array([9]));
    expect(await store.get("vuurtoren/blobs/a.kbl")).toEqual(new Uint8Array([9]));
    expect(await store.list("vuurtoren/blobs")).toEqual(["a.kbl"]);
    expect(caches).toEqual(["no-store", "no-store", "no-store"]);
  });
});

describe("credentials refused", () => {
  it("says so in plain words", async () => {
    const wrong = serverStore(
      "https://vuurtoren.example",
      "nope",
      fakeServer(new Map(), "ksync_t"),
    );
    await expect(wrong.list("")).rejects.toThrow(/did not accept the sync token/);
    const offline = webdavStore("https://dav.example/x", "a", "b", (async () => {
      throw new TypeError("network");
    }) as typeof fetch);
    await expect(offline.get("a")).rejects.toThrow(/cannot be reached/);
  });

  it("reads Nextcloud's PROPFIND answer", () => {
    const xml = `<d:multistatus xmlns:d="DAV:"><d:response><d:href>/remote.php/dav/files/anna/Vuurtoren/</d:href></d:response><d:response><d:href>/remote.php/dav/files/anna/Vuurtoren/vuurtoren/</d:href></d:response><d:response><d:href>/remote.php/dav/files/anna/Vuurtoren/vault%20file.json</d:href></d:response></d:multistatus>`;
    expect(
      propfindNames(xml, "https://cloud.example/remote.php/dav/files/anna/Vuurtoren/"),
    ).toEqual(["vault file.json", "vuurtoren"]);
  });
});
