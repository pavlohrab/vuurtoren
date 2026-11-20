/** Sync as a device sees it: set up, a second device joins, sync by itself, stop. */
import { describe, expect, it, vi } from "vitest";
import type { KeyValueStorage } from "@app/ai";
import { createRepository } from "@app/db";
import { createNodeDriver } from "@app/db/node";
import { LIGHT_ARGON2 } from "@app/db/testing";
import { fakeServer } from "../sync/fake-places.test-util.js";
import { createLiveSync } from "./liveSync.js";
import type { SyncPlace } from "./syncTypes.js";

function memStorage(): KeyValueStorage & { m: Map<string, string> } {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

/** The key store in memory (the real one uses the OS keychain or IndexedDB). */
function memKeys() {
  let raw: Uint8Array | null = null;
  return {
    get raw() {
      return raw;
    },
    save: async (r: Uint8Array) => void (raw = r.slice()),
    load: async () => raw,
    forget: async () => void (raw = null),
  };
}

const PASS = "lange zinnen lezen";
async function device(id: string, fetch: typeof globalThis.fetch, clock: { t: number }) {
  const repo = await createRepository(await createNodeDriver(), { deviceId: id });
  const storage = memStorage();
  const changed = vi.fn();
  const keys = memKeys();
  const sync = createLiveSync({
    repo,
    storage,
    fetch,
    changed,
    now: () => clock.t,
    cost: LIGHT_ARGON2,
    keys,
  });
  return { repo, storage, changed, sync, keys };
}

describe("sync on a device", () => {
  it("starts new data, a second device joins with the passphrase, changes travel both ways", async () => {
    const clock = { t: Date.UTC(2026, 10, 20, 9) };
    const fetch = fakeServer(new Map(), "ksync_t");
    const place: SyncPlace = { kind: "server", url: "https://vuurtoren.example", token: "ksync_t" };
    const laptop = await device("aaaaaaaaaaaa", fetch, clock);
    const phone = await device("bbbbbbbbbbbb", fetch, clock);

    expect(await laptop.sync.services.syncStatus()).toMatchObject({ available: true, place: null });
    await laptop.repo.append({ type: "WordStateSet", lang: "nl", key: "fiets", state: "known" });
    const first = await laptop.sync.services.setUpSync(place, "start", PASS, "Laptop");
    expect(first).toMatchObject({
      created: true,
      place: { kind: "server", label: "Vuurtoren server · vuurtoren.example" },
      last: { sent: 1, received: 0 },
      error: null,
    });
    // Only the key is kept, never the passphrase.
    expect([...laptop.storage.m.values()].join()).not.toContain(PASS);

    await expect(
      phone.sync.services.setUpSync(place, "join", "verkeerd wachtwoord", "Phone"),
    ).rejects.toThrow(/passphrase/);
    const joined = await phone.sync.services.setUpSync(place, "join", PASS, "Phone");
    expect(joined).toMatchObject({ created: false, last: { received: 1 } });
    expect(joined.devices.map((d) => d.name)).toEqual(["Phone", "Laptop"]);
    expect(phone.changed).toHaveBeenCalled();
    expect((await phone.repo.word("nl", "fiets"))?.state).toBe("known");

    // Sync by itself: at most once a minute, true when changes came in.
    await phone.repo.append({ type: "WordStateSet", lang: "nl", key: "huis", state: "known" });
    await phone.sync.services.syncNow();
    clock.t += 61_000;
    expect(await laptop.sync.tick()).toBe(true);
    expect(await laptop.sync.tick()).toBe(false);
    expect((await laptop.repo.word("nl", "huis"))?.state).toBe("known");
  });

  it("keeps the key in the key store, and forgets it on stop", async () => {
    const clock = { t: Date.UTC(2026, 10, 20, 9) };
    const fetch = fakeServer(new Map(), "ksync_t");
    const place: SyncPlace = { kind: "server", url: "https://vuurtoren.example", token: "ksync_t" };
    const laptop = await device("aaaaaaaaaaaa", fetch, clock);
    await laptop.sync.services.setUpSync(place, "start", PASS, "Laptop");
    expect(laptop.keys.raw?.length).toBe(64);
    // The key is not in local storage.
    const saved = JSON.parse(laptop.storage.m.get("vuurtoren.sync")!) as Record<string, unknown>;
    expect(saved["key"]).toBeUndefined();

    await laptop.sync.services.stopSync();
    expect(laptop.keys.raw).toBeNull();
  });

  it("keeps why a sync failed, and stops without touching the data", async () => {
    const clock = { t: Date.UTC(2026, 10, 20, 9) };
    let up = true;
    const server = fakeServer(new Map(), "ksync_t");
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!up) throw new TypeError("offline");
      return server(input, init);
    }) as typeof globalThis.fetch;
    const laptop = await device("aaaaaaaaaaaa", fetch, clock);
    const place: SyncPlace = { kind: "server", url: "https://vuurtoren.example", token: "ksync_t" };
    await laptop.sync.services.setUpSync(place, "start", PASS, "Laptop");
    up = false;
    clock.t += 61_000;
    await expect(laptop.sync.tick()).rejects.toThrow(/cannot be reached/);
    expect((await laptop.sync.services.syncStatus()).error).toMatch(/cannot be reached/);
    up = true;
    expect((await laptop.sync.services.syncNow()).error).toBeNull();
    await laptop.sync.services.stopSync();
    expect((await laptop.sync.services.syncStatus()).place).toBeNull();
    expect(await laptop.sync.tick()).toBe(false);
  });

  it("is not available on a page of a Vuurtoren server, and folders need the desktop app", async () => {
    const sync = createLiveSync({
      keys: memKeys(),
      repo: null,
      storage: memStorage(),
      fetch: globalThis.fetch,
      changed: () => undefined,
    });
    expect(await sync.services.syncStatus()).toMatchObject({ available: false, folders: false });
    await expect(
      sync.services.setUpSync({ kind: "folder", path: "/x" }, "start", PASS, "Laptop"),
    ).rejects.toThrow(/its own data/);
    expect(await sync.services.pickSyncFolder()).toBeNull();
  });
});

describe("joining or starting", () => {
  const place: SyncPlace = { kind: "server", url: "https://vuurtoren.example", token: "ksync_t" };
  const start = () => ({ t: Date.UTC(2026, 10, 20, 9) });

  it("joining never makes new data: before the first device's files arrive it waits", async () => {
    const files = new Map<string, Uint8Array>();
    const phone = await device("bbbbbbbbbbbb", fakeServer(files, "ksync_t"), start());
    await expect(phone.sync.services.setUpSync(place, "join", PASS, "Phone")).rejects.toThrow(
      /no Vuurtoren sync data in this place yet/,
    );
    expect(files.size).toBe(0);
    expect(phone.sync.configured()).toBe(false);
  });

  it("starting refuses a place that already holds sync data or device folders", async () => {
    const files = new Map<string, Uint8Array>();
    const fetch = fakeServer(files, "ksync_t");
    const laptop = await device("aaaaaaaaaaaa", fetch, start());
    await laptop.sync.services.setUpSync(place, "start", PASS, "Laptop");
    const phone = await device("bbbbbbbbbbbb", fetch, start());
    await expect(phone.sync.services.setUpSync(place, "start", PASS, "Phone")).rejects.toThrow(
      /already holds Vuurtoren sync data/,
    );
    // The device folders arrived, the vault not yet (a synced folder still copying).
    files.delete("vuurtoren/vault.json");
    await expect(phone.sync.services.setUpSync(place, "start", PASS, "Phone")).rejects.toThrow(
      /files from other devices/,
    );
    expect(files.has("vuurtoren/vault.json")).toBe(false);
    expect(phone.sync.configured()).toBe(false);
  });

  it("checks the new vault was kept before it shows a recovery key", async () => {
    const server = fakeServer(new Map(), "ksync_t");
    // A place that answers a write but does not keep it.
    const forgetful = (async (input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "PUT" ? Response.json({ ok: true }) : server(input, init)) as typeof fetch;
    const laptop = await device("aaaaaaaaaaaa", forgetful, start());
    await expect(laptop.sync.services.setUpSync(place, "start", PASS, "Laptop")).rejects.toThrow(
      /did not keep/,
    );
    expect(laptop.sync.configured()).toBe(false);
  });

  it("keeps the recovery key and sync set up when the first sync fails", async () => {
    const server = fakeServer(new Map(), "ksync_t");
    // vault.json goes in; the first segment does not.
    const failing = (async (input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "PUT" && String(input).includes("devices")
        ? new Response('{"ok":false,"error":"Disk full."}', { status: 507 })
        : server(input, init)) as typeof fetch;
    const laptop = await device("aaaaaaaaaaaa", failing, start());
    await laptop.repo.append({ type: "WordStateSet", lang: "nl", key: "fiets", state: "known" });
    const r = await laptop.sync.services.setUpSync(place, "start", PASS, "Laptop");
    expect(r.created).toBe(true);
    expect(r.recoveryKey).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4})+$/);
    expect(r.error).toBeTruthy();
    expect(r.place).not.toBeNull();
    expect(laptop.sync.configured()).toBe(true);
  });

  it("drops the caches when a sync fails after some changes came in", async () => {
    const clock = start();
    const server = fakeServer(new Map(), "ksync_t");
    let failDevices = false;
    // Listing the devices (the last step, after importing) fails.
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
      failDevices && !init?.method && String(input).includes("device.kev")
        ? new Response('{"ok":false,"error":"Gone for a moment."}', { status: 503 })
        : server(input, init)) as typeof globalThis.fetch;
    const laptop = await device("aaaaaaaaaaaa", fetch, clock);
    const phone = await device("bbbbbbbbbbbb", fetch, clock);
    await laptop.sync.services.setUpSync(place, "start", PASS, "Laptop");
    await phone.sync.services.setUpSync(place, "join", PASS, "Phone");
    phone.changed.mockClear();
    await laptop.repo.append({ type: "WordStateSet", lang: "nl", key: "huis", state: "known" });
    await laptop.sync.services.syncNow();
    failDevices = true;
    await expect(phone.sync.services.syncNow()).rejects.toThrow();
    expect((await phone.repo.word("nl", "huis"))?.state).toBe("known");
    expect(phone.changed).toHaveBeenCalledTimes(1);
  });

  it("runs setup alone, and Stop during setup stays stopped", async () => {
    const clock = start();
    const laptop = await device("aaaaaaaaaaaa", fakeServer(new Map(), "ksync_t"), clock);
    const setting = laptop.sync.services.setUpSync(place, "start", PASS, "Laptop");
    const stopping = laptop.sync.services.stopSync();
    // A sync by itself does not run next to the setup.
    clock.t += 61_000;
    expect(await laptop.sync.tick()).toBe(false);
    await setting;
    await stopping;
    expect((await laptop.sync.services.syncStatus()).place).toBeNull();
  });

  it("sends the last changes when the app is left, only when there are any", async () => {
    const clock = start();
    const files = new Map<string, Uint8Array>();
    const laptop = await device("aaaaaaaaaaaa", fakeServer(files, "ksync_t"), clock);
    await laptop.sync.services.setUpSync(place, "start", PASS, "Laptop");
    const segments = () =>
      [...files.keys()].filter((k) => /devices\/aaaaaaaaaaaa\/[0-9A-Z]+\.kev$/.test(k)).length;
    expect(segments()).toBe(0);
    await laptop.repo.append({ type: "WordStateSet", lang: "nl", key: "fiets", state: "known" });
    // Just synced: switching windows right away does not sync again.
    await laptop.sync.services.syncBeforeLeaving!();
    expect(segments()).toBe(0);
    clock.t += 20_000;
    await laptop.sync.services.syncBeforeLeaving!();
    expect(segments()).toBe(1);
    const at = (await laptop.sync.services.syncStatus()).last!.at;
    clock.t += 20_000;
    await laptop.sync.services.syncBeforeLeaving!();
    expect((await laptop.sync.services.syncStatus()).last!.at).toBe(at);
  });
});
