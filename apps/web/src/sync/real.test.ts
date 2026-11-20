/**
 * Sync against real places, when their addresses are given (skipped otherwise):
 *   VUURTOREN_TEST_WEBDAV_URL, VUURTOREN_TEST_WEBDAV_USER, VUURTOREN_TEST_WEBDAV_PASSWORD
 *   VUURTOREN_TEST_GITHUB_REPO (owner/name, private, empty), VUURTOREN_TEST_GITHUB_TOKEN
 * Each run writes under a fresh folder of the place and removes what it can afterwards.
 */
import { describe, expect, it } from "vitest";
import { type SyncStore, createRepository, openVault, syncOnce } from "@app/db";
import { createNodeDriver } from "@app/db/node";
import { LIGHT_ARGON2 } from "@app/db/testing";
import { githubStore } from "./githubStore.js";
import { webdavStore } from "./webdavStore.js";

const env = process.env;
/** A store whose paths all live under `prefix` (one run's own folder). */
function under(store: SyncStore, prefix: string): SyncStore {
  const p = (path: string) => (path ? `${prefix}/${path}` : prefix);
  return {
    label: store.label,
    list: (dir) => store.list(p(dir)),
    get: (path) => store.get(p(path)),
    put: (path, bytes) => store.put(p(path), bytes),
    remove: (path) => store.remove(p(path)),
  };
}

async function roundTrip(store: SyncStore) {
  // Files: write, replace, list, read, remove.
  await store.put("vuurtoren/devices/abc/1.kev", new Uint8Array([1, 2]));
  await store.put("vuurtoren/devices/abc/1.kev", new Uint8Array([3]));
  expect(await store.list("vuurtoren/devices")).toEqual(["abc"]);
  expect(await store.get("vuurtoren/devices/abc/1.kev")).toEqual(new Uint8Array([3]));
  expect(await store.get("vuurtoren/devices/abc/none.kev")).toBeNull();
  expect(await store.list("vuurtoren/nothing")).toEqual([]);
  await store.remove("vuurtoren/devices/abc/1.kev");
  // Two devices with the real engine, folding included.
  const a = await createRepository(await createNodeDriver(), { deviceId: "aaaaaaaaaaaa" });
  const b = await createRepository(await createNodeDriver(), { deviceId: "bbbbbbbbbbbb" });
  const { key } = await openVault(store, "lange zinnen lezen", true, LIGHT_ARGON2);
  const cover = await a.putBlob(
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 7]),
    "image/png",
  );
  await a.append({
    type: "TextImported",
    textId: "t1",
    title: "Echt",
    lang: "nl",
    source: { kind: "paste" },
    content: "Een echte test.",
  });
  await a.append({ type: "TextCoverSet", textId: "t1", blobId: cover });
  for (let i = 0; i < 6; i++) {
    await a.append({ type: "WordStateSet", lang: "nl", key: `w${i}`, state: "known" });
    await syncOnce(a, store, key, {
      deviceName: "Laptop",
      testLimits: { segmentEvents: 2, foldAfter: 3 },
    });
  }
  const got = await syncOnce(b, store, key, { deviceName: "Phone" });
  expect(got.received).toBe(8);
  expect((await b.getBlob(cover))?.type).toBe("image/png");
  expect(got.devices!.map((d) => d.name).sort()).toEqual(["Laptop", "Phone"]);
  await b.append({ type: "WordStateSet", lang: "nl", key: "terug", state: "known" });
  await syncOnce(b, store, key, { deviceName: "Phone" });
  expect((await syncOnce(a, store, key, { deviceName: "Laptop" })).received).toBe(1);
}

const run = `vuurtoren-test-${Date.now()}`;

describe.runIf(env["VUURTOREN_TEST_WEBDAV_URL"])("a real WebDAV server", () => {
  it("syncs two devices", { timeout: 120_000 }, async () => {
    const store = webdavStore(
      env["VUURTOREN_TEST_WEBDAV_URL"]!,
      env["VUURTOREN_TEST_WEBDAV_USER"] ?? "",
      env["VUURTOREN_TEST_WEBDAV_PASSWORD"] ?? "",
      fetch,
    );
    await roundTrip(under(store, run));
  });
});

describe.runIf(env["VUURTOREN_TEST_GITHUB_TOKEN"])("a real GitHub repository", () => {
  it("syncs two devices", { timeout: 300_000 }, async () => {
    const store = githubStore(
      env["VUURTOREN_TEST_GITHUB_REPO"]!,
      env["VUURTOREN_TEST_GITHUB_TOKEN"]!,
      fetch,
    );
    await roundTrip(under(store, run));
  });
});
