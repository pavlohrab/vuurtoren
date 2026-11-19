/** Sync as a device sees it: set up, a second device joins, sync by itself, stop. */
import { describe, expect, it, vi } from "vitest";
import type { KeyValueStorage } from "@app/ai";
import { createRepository } from "@app/db";
import { createNodeDriver } from "@app/db/node";
import { fakeServer } from "../sync/fakePlaces.test-util.js";
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

const PASS = "lange zinnen lezen";

async function device(id: string, fetch: typeof globalThis.fetch, clock: { t: number }) {
  const repo = await createRepository(await createNodeDriver(), { deviceId: id });
  const storage = memStorage();
  const changed = vi.fn();
  const sync = createLiveSync({ repo, storage, fetch, changed, now: () => clock.t });
  return { repo, storage, changed, sync };
}

describe("sync on a device", () => {
  it("starts new data, a second device joins with the passphrase, changes travel both ways", async () => {
    const clock = { t: Date.UTC(2026, 10, 20, 9) };
    const fetch = fakeServer(new Map(), "ksync_t");
    const place: SyncPlace = { kind: "server", url: "https://kenning.example", token: "ksync_t" };
    const laptop = await device("aaaaaaaaaaaa", fetch, clock);
    const phone = await device("bbbbbbbbbbbb", fetch, clock);

    expect(await laptop.sync.services.syncStatus()).toMatchObject({ available: true, place: null });
    await laptop.repo.append({ type: "WordStateSet", lang: "nl", key: "fiets", state: "known" });
    const first = await laptop.sync.services.setUpSync(place, PASS, "Laptop");
    expect(first).toMatchObject({
      created: true,
      place: { kind: "server", label: "Kenning server · kenning.example" },
      last: { sent: 1, received: 0 },
      error: null,
    });
    // Only the key is kept, never the passphrase.
    expect([...laptop.storage.m.values()].join()).not.toContain(PASS);

    await expect(
      phone.sync.services.setUpSync(place, "verkeerd wachtwoord", "Phone"),
    ).rejects.toThrow(/passphrase/);
    const joined = await phone.sync.services.setUpSync(place, PASS, "Phone");
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

  it("keeps why a sync failed, and stops without touching the data", async () => {
    const clock = { t: Date.UTC(2026, 10, 20, 9) };
    let up = true;
    const server = fakeServer(new Map(), "ksync_t");
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!up) throw new TypeError("offline");
      return server(input, init);
    }) as typeof globalThis.fetch;
    const laptop = await device("aaaaaaaaaaaa", fetch, clock);
    const place: SyncPlace = { kind: "server", url: "https://kenning.example", token: "ksync_t" };
    await laptop.sync.services.setUpSync(place, PASS, "Laptop");
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

  it("is not available on a page of a Kenning server, and folders need the desktop app", async () => {
    const sync = createLiveSync({
      repo: null,
      storage: memStorage(),
      fetch: globalThis.fetch,
      changed: () => undefined,
    });
    expect(await sync.services.syncStatus()).toMatchObject({ available: false, folders: false });
    await expect(
      sync.services.setUpSync({ kind: "folder", path: "/x" }, PASS, "Laptop"),
    ).rejects.toThrow(/its own data/);
    expect(await sync.services.pickSyncFolder()).toBeNull();
  });
});
