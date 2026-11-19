/**
 * The three places behind fake servers: the same behaviour from each, and two devices syncing
 * through each with the real engine.
 */
import { describe, expect, it } from "vitest";
import { type SyncStore, createRepository, openVault, syncOnce } from "@app/db";
import { createNodeDriver } from "@app/db/node";
import { githubStore } from "./githubStore.js";
import { propfindNames, webdavStore } from "./webdavStore.js";
import { serverStore } from "./serverStore.js";
import { fakeDav, fakeGithub, fakeServer } from "./fakePlaces.test-util.js";

/** A light Argon2id cost: tests stay fast. */
const LIGHT = { memoryKiB: 64, iterations: 1, parallelism: 1 };

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
    const key = (await openVault(store, "lange zinnen lezen", true, LIGHT)).key;
    await a.append({ type: "WordStateSet", lang: "nl", key: "fiets", state: "known" });
    await syncOnce(a, store, key, { deviceName: "Laptop" });
    expect(await syncOnce(b, store, key, { deviceName: "Phone" })).toMatchObject({ received: 1 });
    expect((await b.word("nl", "fiets"))?.state).toBe("known");
  });
});

describe("credentials refused", () => {
  it("says so in plain words", async () => {
    const wrong = serverStore("https://kenning.example", "nope", fakeServer(new Map(), "ksync_t"));
    await expect(wrong.list("")).rejects.toMatchObject({ kind: "auth" });
    const offline = webdavStore("https://dav.example/x", "a", "b", (async () => {
      throw new TypeError("network");
    }) as typeof fetch);
    await expect(offline.get("a")).rejects.toMatchObject({ kind: "offline" });
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
