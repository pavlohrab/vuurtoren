/**
 * The three places behind fake servers: the same behaviour from each, and two devices syncing
 * through each with the real engine.
 */
import { describe, expect, it } from "vitest";
import { type SyncStore, createRepository, openVault, syncOnce } from "@app/db";
import { createNodeDriver } from "@app/db/node";
import { LIGHT_ARGON2 } from "@app/db/testing";
import { githubStore } from "./githubStore.js";
import { propfindNames, webdavStore } from "./webdavStore.js";
import { serverStore } from "./serverStore.js";
import { fakeDav, fakeGithub, fakeServer } from "./fake-places.test-util.js";

const places: [string, () => SyncStore][] = [
  [
    "Kenning server",
    () => serverStore("https://kenning.example/", "ksync_t", fakeServer(new Map(), "ksync_t")),
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
  ["GitHub", () => githubStore("anna/kenning-sync", "ghp_x", fakeGithub(new Map()))],
];

describe.each(places)("%s", (_name, make) => {
  it("lists, reads, writes, replaces and removes files", async () => {
    const store = make();
    expect(await store.list("kenning/devices")).toEqual([]);
    expect(await store.get("kenning/vault.json")).toBeNull();
    await store.put("kenning/devices/abc/1.kev", new Uint8Array([1, 2]));
    await store.put("kenning/devices/abc/1.kev", new Uint8Array([3]));
    await store.put("kenning/devices/def/2.kev", new Uint8Array([4]));
    expect(await store.list("kenning/devices")).toEqual(["abc", "def"]);
    expect(await store.list("kenning/devices/abc")).toEqual(["1.kev"]);
    expect(await store.get("kenning/devices/abc/1.kev")).toEqual(new Uint8Array([3]));
    await store.remove("kenning/devices/abc/1.kev");
    await store.remove("kenning/devices/abc/1.kev");
    expect(await store.get("kenning/devices/abc/1.kev")).toBeNull();
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

describe("GitHub", () => {
  it("lists a folder past 1000 files and never asks the browser cache", async () => {
    const files = new Map<string, Uint8Array>();
    for (let i = 0; i < 1200; i++) {
      files.set(`kenning/blobs/${String(i).padStart(4, "0")}.kbl`, new Uint8Array([i % 256]));
    }
    const caches: (RequestCache | undefined)[] = [];
    const fake = fakeGithub(files);
    const store = githubStore("anna/kenning-sync", "ghp_x", (async (input, init) => {
      caches.push(init?.cache);
      return fake(input, init);
    }) as typeof fetch);
    const names = await store.list("kenning/blobs");
    expect(names).toHaveLength(1200);
    expect(names[1199]).toBe("1199.kbl");
    // The sha came with the listing: a file past the first 1000 can be replaced.
    await store.put("kenning/blobs/1199.kbl", new Uint8Array([9]));
    expect(await store.get("kenning/blobs/1199.kbl")).toEqual(new Uint8Array([9]));
    expect(caches.length).toBeGreaterThan(2);
    expect(caches.every((c) => c === "no-store")).toBe(true);
  });
});

describe("credentials refused", () => {
  it("says so in plain words", async () => {
    const wrong = serverStore("https://kenning.example", "nope", fakeServer(new Map(), "ksync_t"));
    await expect(wrong.list("")).rejects.toThrow(/did not accept the sync token/);
    const offline = webdavStore("https://dav.example/x", "a", "b", (async () => {
      throw new TypeError("network");
    }) as typeof fetch);
    await expect(offline.get("a")).rejects.toThrow(/cannot be reached/);
    expect(() => githubStore("not a repo", "t", fetch)).toThrow(/owner\/name/);
  });

  it("reads Nextcloud's PROPFIND answer", () => {
    const xml = `<d:multistatus xmlns:d="DAV:"><d:response><d:href>/remote.php/dav/files/anna/Kenning/</d:href></d:response><d:response><d:href>/remote.php/dav/files/anna/Kenning/kenning/</d:href></d:response><d:response><d:href>/remote.php/dav/files/anna/Kenning/vault%20file.json</d:href></d:response></d:multistatus>`;
    expect(propfindNames(xml, "https://cloud.example/remote.php/dav/files/anna/Kenning/")).toEqual([
      "kenning",
      "vault file.json",
    ]);
  });
});
