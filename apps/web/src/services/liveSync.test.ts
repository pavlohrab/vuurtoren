/** Sync as a device sees it: set up, a second device joins, sync by itself, leave, stop. */
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
async function device(
  id: string,
  fetch: typeof globalThis.fetch,
  clock: { t: number },
  over: Partial<Parameters<typeof createLiveSync>[0]> = {},
) {
  const repo = await createRepository(await createNodeDriver(), { deviceId: id });
  const storage = memStorage();
  const changed = vi.fn();
  const keys = memKeys();
  const deps = { repo, storage, fetch, changed, now: () => clock.t, cost: LIGHT_ARGON2, keys };
  const sync = createLiveSync({ ...deps, ...over });
  /** The app opened again: the same data, storage and key store, nothing in memory. */
  const reopen = () => createLiveSync({ ...deps, ...over });
  return { repo, storage, changed, sync, keys, reopen };
}

/** This device's segment files in the place. */
const segments = (files: Map<string, Uint8Array>, id: string) =>
  [...files.keys()].filter((k) => new RegExp(`devices/${id}/[0-9A-Z]+\\.kev$`).test(k)).length;

describe("sync on a device", () => {
  it("starts new data, a second device joins with the passphrase, changes travel both ways", async () => {
    const clock = { t: Date.UTC(2026, 10, 20, 9) };
    const fetch = fakeServer(new Map(), "ksync_t");
    const place: SyncPlace = { kind: "server", url: "https://vuurtoren.example", token: "ksync_t" };
    const laptop = await device("aaaaaaaaaaaa", fetch, clock);
    const phone = await device("bbbbbbbbbbbb", fetch, clock);

    expect(await laptop.sync.services.syncStatus()).toMatchObject({ desktop: false, place: null });
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

    // Sync by itself: the timer pulls every 15 s; changed when changes came in.
    await phone.repo.append({ type: "WordStateSet", lang: "nl", key: "huis", state: "known" });
    await phone.sync.services.syncNow();
    clock.t += 16_000;
    expect(await laptop.sync.auto("timer")).toEqual({ ran: true, changed: true, error: null });
    expect(await laptop.sync.auto("timer")).toMatchObject({ ran: false });
    expect((await laptop.repo.word("nl", "huis"))?.state).toBe("known");
    // Coming back into view pulls too, unless a sync just ran.
    expect(await laptop.sync.auto("focus")).toMatchObject({ ran: false });
    clock.t += 6_000;
    expect(await laptop.sync.auto("focus")).toMatchObject({ ran: true, changed: false });
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
    clock.t += 16_000;
    const failed = await laptop.sync.auto("timer");
    expect(failed.ran).toBe(true);
    expect(String(failed.error)).toMatch(/cannot be reached/);
    expect((await laptop.sync.services.syncStatus()).error).toMatch(/cannot be reached/);
    // After a failure nothing runs by itself for a while.
    clock.t += 6_000;
    expect(await laptop.sync.auto("focus")).toMatchObject({ ran: false });
    up = true;
    expect((await laptop.sync.services.syncNow()).error).toBeNull();
    await laptop.sync.services.stopSync();
    expect((await laptop.sync.services.syncStatus()).place).toBeNull();
    expect(await laptop.sync.auto("start")).toMatchObject({ ran: false });
  });

  it("a folder and WebDAV need the desktop app", async () => {
    const clock = { t: Date.UTC(2026, 10, 20, 9) };
    const { sync } = await device("aaaaaaaaaaaa", globalThis.fetch, clock);
    await expect(
      sync.services.setUpSync({ kind: "folder", path: "/x" }, "start", PASS, "Laptop"),
    ).rejects.toThrow(/desktop app/);
    await expect(
      sync.services.setUpSync(
        { kind: "webdav", url: "https://dav.example", user: "a", password: "b" },
        "start",
        PASS,
        "Laptop",
      ),
    ).rejects.toThrow(/desktop app/);
    expect(await sync.services.pickSyncFolder()).toBeNull();
  });

  it("on the page of a Vuurtoren server, that server is the place with a token of its own", async () => {
    const clock = { t: Date.UTC(2026, 10, 20, 9) };
    const files = new Map<string, Uint8Array>();
    const newToken = vi.fn(async () => "ksync_page");
    const page = await device("aaaaaaaaaaaa", fakeServer(files, "ksync_page"), clock, {
      server: { origin: "https://vuurtoren.example", newToken },
    });
    expect((await page.sync.services.syncStatus()).thisServer).toBe("https://vuurtoren.example");
    const r = await page.sync.services.setUpSync(
      { kind: "server", url: "https://vuurtoren.example", token: "" },
      "start",
      PASS,
      "Laptop",
    );
    expect(r.error).toBeNull();
    expect(newToken).toHaveBeenCalledWith("Laptop (this browser)");
    expect(files.has("vuurtoren/vault.json")).toBe(true);
    // Its own language server is reached with its sign-in, not through sync.
    expect(await page.sync.languageServer()).toBeNull();
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
    // The key was kept before the vault was written, and goes again with the failed vault.
    expect(laptop.keys.raw).toBeNull();
  });

  it("keeps the new key before it writes the vault: no vault that no device can open", async () => {
    const files = new Map<string, Uint8Array>();
    const laptop = await device("aaaaaaaaaaaa", fakeServer(files, "ksync_t"), start(), {
      keys: {
        save: () => Promise.reject(new Error("The keychain is locked.")),
        load: async () => null,
        forget: async () => undefined,
      },
    });
    await expect(laptop.sync.services.setUpSync(place, "start", PASS, "Laptop")).rejects.toThrow(
      /keychain is locked/,
    );
    expect(files.size).toBe(0);
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
    expect(await laptop.sync.auto("timer")).toMatchObject({ ran: false });
    await setting;
    await stopping;
    expect((await laptop.sync.services.syncStatus()).place).toBeNull();
  });
});

describe("while the app is open", () => {
  const place: SyncPlace = { kind: "server", url: "https://vuurtoren.example", token: "ksync_t" };
  const start = () => ({ t: Date.UTC(2026, 10, 20, 9) });

  it("syncs once when the app opens", async () => {
    const clock = start();
    const fetch = fakeServer(new Map(), "ksync_t");
    const laptop = await device("aaaaaaaaaaaa", fetch, clock);
    const phone = await device("bbbbbbbbbbbb", fetch, clock);
    await laptop.sync.services.setUpSync(place, "start", PASS, "Laptop");
    await phone.sync.services.setUpSync(place, "join", PASS, "Phone");
    await phone.repo.append({ type: "WordStateSet", lang: "nl", key: "fiets", state: "known" });
    await phone.sync.services.syncNow();
    // The laptop opens again: right away, with nothing in memory.
    const again = laptop.reopen();
    expect(await again.auto("start")).toEqual({ ran: true, changed: true, error: null });
    expect((await laptop.repo.word("nl", "fiets"))?.state).toBe("known");
  });

  it("sends a local change once the log has been quiet for a few seconds", async () => {
    const clock = start();
    const files = new Map<string, Uint8Array>();
    const laptop = await device("aaaaaaaaaaaa", fakeServer(files, "ksync_t"), clock);
    await laptop.sync.services.setUpSync(place, "start", PASS, "Laptop");
    // Nothing changed: the head is looked at, nothing runs.
    expect(await laptop.sync.auto("local")).toMatchObject({ ran: false });
    await laptop.repo.append({ type: "WordStateSet", lang: "nl", key: "fiets", state: "known" });
    clock.t += 5_000;
    expect(await laptop.sync.auto("local")).toMatchObject({ ran: false });
    // Another change: the quiet time starts again.
    await laptop.repo.append({ type: "WordStateSet", lang: "nl", key: "huis", state: "known" });
    clock.t += 5_000;
    expect(await laptop.sync.auto("local")).toMatchObject({ ran: false });
    clock.t += 3_000;
    expect(await laptop.sync.auto("local")).toMatchObject({ ran: false });
    clock.t += 2_000;
    expect(await laptop.sync.auto("local")).toMatchObject({ ran: true });
    expect(segments(files, "aaaaaaaaaaaa")).toBe(1);
    expect((await laptop.sync.services.syncStatus()).last).toMatchObject({ sent: 2 });
    clock.t += 5_000;
    expect(await laptop.sync.auto("local")).toMatchObject({ ran: false });
  });

  it("sends what is not sent when the app is left, also right after a sync", async () => {
    const clock = start();
    const files = new Map<string, Uint8Array>();
    const laptop = await device("aaaaaaaaaaaa", fakeServer(files, "ksync_t"), clock);
    await laptop.sync.services.setUpSync(place, "start", PASS, "Laptop");
    expect(segments(files, "aaaaaaaaaaaa")).toBe(0);
    await laptop.repo.append({ type: "WordStateSet", lang: "nl", key: "fiets", state: "known" });
    // Hidden, then closed: both ask, one sync answers.
    await Promise.all([
      laptop.sync.services.syncBeforeLeaving!(),
      laptop.sync.services.syncBeforeLeaving!(),
    ]);
    expect(segments(files, "aaaaaaaaaaaa")).toBe(1);
    const at = (await laptop.sync.services.syncStatus()).last!.at;
    clock.t += 1_000;
    // Nothing new: nothing runs.
    await laptop.sync.services.syncBeforeLeaving!();
    expect((await laptop.sync.services.syncStatus()).last!.at).toBe(at);
  });

  it("keeps what did not sync in the status", async () => {
    const clock = start();
    const files = new Map<string, Uint8Array>();
    const laptop = await device("aaaaaaaaaaaa", fakeServer(files, "ksync_t"), clock);
    await laptop.sync.services.setUpSync(place, "start", PASS, "Laptop");
    files.set("vuurtoren/devices/bbbbbbbbbbbb/01J0000000000000000000000A.kev", new Uint8Array([1]));
    const s = await laptop.sync.services.syncNow();
    expect(s.problems).toEqual([
      expect.objectContaining({
        what: "vuurtoren/devices/bbbbbbbbbbbb/01J0000000000000000000000A.kev",
      }),
    ]);
    expect((await laptop.sync.services.syncStatus()).problems).toHaveLength(1);
  });
});

describe("passphrase, recovery key and a lost key", () => {
  const place: SyncPlace = { kind: "server", url: "https://vuurtoren.example", token: "ksync_t" };
  const start = () => ({ t: Date.UTC(2026, 10, 20, 9) });

  it("a new passphrase opens the data on a new device; the others keep syncing", async () => {
    const clock = start();
    const fetch = fakeServer(new Map(), "ksync_t");
    const laptop = await device("aaaaaaaaaaaa", fetch, clock);
    const phone = await device("bbbbbbbbbbbb", fetch, clock);
    await laptop.sync.services.setUpSync(place, "start", PASS, "Laptop");
    await phone.sync.services.setUpSync(place, "join", PASS, "Phone");
    await expect(
      laptop.sync.services.changeSyncPassphrase("verkeerd wachtwoord", "nieuwe lange zin"),
    ).rejects.toThrow();
    await laptop.sync.services.changeSyncPassphrase(PASS, "nieuwe lange zin");
    // The phone keeps its key: no file changed.
    await laptop.repo.append({ type: "WordStateSet", lang: "nl", key: "fiets", state: "known" });
    await laptop.sync.services.syncNow();
    expect((await phone.sync.services.syncNow()).error).toBeNull();
    expect((await phone.repo.word("nl", "fiets"))?.state).toBe("known");
    // A new device: only the new passphrase opens it.
    const tablet = await device("cccccccccccc", fetch, clock);
    await expect(tablet.sync.services.setUpSync(place, "join", PASS, "Tablet")).rejects.toThrow();
    const joined = await tablet.sync.services.setUpSync(
      place,
      "join",
      "nieuwe lange zin",
      "Tablet",
    );
    expect(joined.error).toBeNull();
    expect((await tablet.repo.word("nl", "fiets"))?.state).toBe("known");
  });

  it("joins with the recovery key, and a new recovery key replaces the old one", async () => {
    const clock = start();
    const fetch = fakeServer(new Map(), "ksync_t");
    const laptop = await device("aaaaaaaaaaaa", fetch, clock);
    const first = await laptop.sync.services.setUpSync(place, "start", PASS, "Laptop");
    const recovery = first.recoveryKey!;
    const phone = await device("bbbbbbbbbbbb", fetch, clock);
    expect(
      (await phone.sync.services.setUpSync(place, "join", recovery, "Phone")).error,
    ).toBeNull();
    const next = await laptop.sync.services.newSyncRecoveryKey(recovery);
    expect(next).not.toBe(recovery);
    const tablet = await device("cccccccccccc", fetch, clock);
    await expect(
      tablet.sync.services.setUpSync(place, "join", recovery, "Tablet"),
    ).rejects.toThrow();
    expect((await tablet.sync.services.setUpSync(place, "join", next, "Tablet")).error).toBeNull();
  });

  it("asks for the passphrase when the key is gone, and unlocks with it", async () => {
    const clock = start();
    const laptop = await device("aaaaaaaaaaaa", fakeServer(new Map(), "ksync_t"), clock);
    await laptop.sync.services.setUpSync(place, "start", PASS, "Laptop");
    await laptop.keys.forget();
    const missing = await laptop.sync.auto("start");
    expect(String(missing.error)).toMatch(/does not have its sync key/);
    expect(await laptop.sync.services.syncStatus()).toMatchObject({ needsKey: true });
    // Nothing runs by itself until it is unlocked.
    clock.t += 60_000;
    expect(await laptop.sync.auto("timer")).toMatchObject({ ran: false });
    await expect(laptop.sync.services.unlockSync("verkeerd wachtwoord")).rejects.toThrow();
    const back = await laptop.sync.services.unlockSync(PASS);
    expect(back).toMatchObject({ needsKey: false, error: null });
    expect(laptop.keys.raw?.length).toBe(64);
  });
});

describe("the language server of a sync server", () => {
  it("is the place's /nlp with its token in a browser, never in the desktop app", async () => {
    const clock = { t: Date.UTC(2026, 10, 20, 9) };
    const fetch = fakeServer(new Map(), "ksync_t");
    const place: SyncPlace = {
      kind: "server",
      url: "https://vuurtoren.example/",
      token: "ksync_t",
    };
    const phone = await device("bbbbbbbbbbbb", fetch, clock);
    expect(await phone.sync.languageServer()).toBeNull();
    await phone.sync.services.setUpSync(place, "start", PASS, "Phone");
    expect(await phone.sync.languageServer()).toEqual({
      url: "https://vuurtoren.example/nlp",
      token: "ksync_t",
    });
  });
});

/** A Vuurtoren server that pairs: one code, used once, buys the token `token`. */
function pairingServer(files: Map<string, Uint8Array>, token: string, code: string) {
  const sync = fakeServer(files, token);
  const paired: { name: string }[] = [];
  let used = false;
  const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/sync/pair") {
      const body = JSON.parse(String(init.body)) as { code: string; name: string };
      if (used || body.code !== code) {
        return Response.json(
          { ok: false, error: "This pairing code does not work." },
          { status: 403 },
        );
      }
      used = true;
      paired.push({ name: body.name });
      return Response.json({ ok: true, token, id: "abc", label: body.name });
    }
    return sync(input, init);
  }) as typeof globalThis.fetch;
  return { fetch, paired };
}

/** The token keeper in memory (the real one is the key store). */
function memTokens() {
  let token: string | null = null;
  return {
    get token() {
      return token;
    },
    save: async (t: string) => void (token = t),
    load: async () => token,
    forget: async () => void (token = null),
  };
}

const SERVER = "https://vuurtoren.example";

describe("connecting to a server with a pairing code", () => {
  it("keeps the token in the key store, joins with the passphrase, and uses the server's /nlp", async () => {
    const clock = { t: Date.UTC(2026, 10, 20, 9) };
    const files = new Map<string, Uint8Array>();
    const server = pairingServer(files, "ksync_phone", "ABCDE-FGHJK");
    const laptopPlace: SyncPlace = { kind: "server", url: SERVER, token: "ksync_phone" };
    const laptop = await device("aaaaaaaaaaaa", server.fetch, clock);
    await laptop.repo.append({ type: "WordStateSet", lang: "nl", key: "fiets", state: "known" });
    await laptop.sync.services.setUpSync(laptopPlace, "start", PASS, "Laptop");

    const tokens = memTokens();
    const link = `vuurtoren://connect?server=${encodeURIComponent(SERVER)}&code=ABCDE-FGHJK`;
    const links = { take: vi.fn(async () => [link]) };
    const phone = await device("bbbbbbbbbbbb", server.fetch, clock, {
      tokens,
      links,
      phone: true,
      scanQr: async () => null,
    });
    const before = await phone.sync.services.syncStatus();
    expect(before).toMatchObject({ scan: true, paired: null, places: ["server"] });
    expect(await phone.sync.services.pendingConnectLink()).toBe(link);
    // Taken from the app once, kept until connecting succeeds.
    links.take.mockResolvedValue([]);
    expect(await phone.sync.services.pendingConnectLink()).toBe(link);

    await expect(
      phone.sync.services.connectServer({ server: SERVER, code: "ZZZZZ-ZZZZZ" }, "Phone"),
    ).rejects.toThrow(/does not work/);
    const connected = await phone.sync.services.connectServer(
      { server: SERVER, code: "ABCDE-FGHJK" },
      "Phone",
    );
    expect(connected.paired).toBe(SERVER);
    expect(server.paired[0]!.name).toMatch(/^Phone/);
    expect(tokens.token).toBe("ksync_phone");
    // The token is in the key store, never in the device's storage.
    expect([...phone.storage.m.values()].join()).not.toContain("ksync_phone");
    expect(await phone.sync.services.pendingConnectLink()).toBeNull();
    // The server is the language server already, before sync is set up.
    expect(await phone.sync.languageServer()).toEqual({
      url: `${SERVER}/nlp`,
      token: "ksync_phone",
    });

    const joined = await phone.sync.services.setUpSync(
      { kind: "server", url: connected.paired!, token: "", kept: true },
      "join",
      PASS,
      "Phone",
    );
    expect(joined).toMatchObject({ error: null, paired: null, last: { received: 1 } });
    expect((await phone.repo.word("nl", "fiets"))?.state).toBe("known");
    expect([...phone.storage.m.values()].join()).not.toContain("ksync_phone");

    // Opened again: the token comes from the key store.
    const again = phone.reopen();
    await phone.repo.append({ type: "WordStateSet", lang: "nl", key: "huis", state: "known" });
    expect((await again.services.syncNow()).error).toBeNull();
    await laptop.sync.services.syncNow();
    expect((await laptop.repo.word("nl", "huis"))?.state).toBe("known");

    await again.services.stopSync();
    expect(tokens.token).toBeNull();
    expect(await again.services.syncStatus()).toMatchObject({ place: null, paired: null });
  });

  it("asks to connect again when the key store lost the token", async () => {
    const clock = { t: Date.UTC(2026, 10, 20, 9) };
    const server = pairingServer(new Map(), "ksync_phone", "ABCDE-FGHJK");
    const tokens = memTokens();
    const phone = await device("bbbbbbbbbbbb", server.fetch, clock, { tokens });
    await phone.sync.services.connectServer({ server: SERVER, code: "ABCDE-FGHJK" }, "Phone");
    await phone.sync.services.setUpSync(
      { kind: "server", url: SERVER, token: "", kept: true },
      "start",
      PASS,
      "Phone",
    );
    await tokens.forget();
    await expect(phone.reopen().services.syncNow()).rejects.toThrow(/connect to the server again/);
  });
});

describe("a phone and its computer at home", () => {
  it("scanning the computer's code again at a new address only moves it", async () => {
    const clock = { t: Date.UTC(2026, 10, 25, 9) };
    const files = new Map<string, Uint8Array>();
    const server = pairingServer(files, "ksync_phone", "ABCDE-FGHJK");
    const [OLD, NEW, FP] = [
      "https://192.168.1.20:47120",
      "https://192.168.1.31:47120",
      "ab".repeat(32),
    ];
    const laptop = await device("aaaaaaaaaaaa", server.fetch, clock);
    await laptop.repo.append({ type: "WordStateSet", lang: "nl", key: "fiets", state: "known" });
    await laptop.sync.services.setUpSync(
      { kind: "server", url: OLD, token: "ksync_phone" },
      "start",
      PASS,
      "Laptop",
    );
    // The phone reaches the computer through the app, at the computer's address of the moment.
    let home = OLD;
    const desktop = {
      fetch: async (req: {
        url: string;
        method: string;
        headers: Record<string, string>;
        body?: Uint8Array;
      }) => {
        if (!req.url.startsWith(home)) throw new Error("No route to host");
        const r = await server.fetch(req.url, {
          method: req.method,
          headers: req.headers,
          body: (req.body ?? null) as BodyInit | null,
        });
        return {
          status: r.status,
          headers: Object.fromEntries(r.headers),
          body: new Uint8Array(await r.arrayBuffer()),
        };
      },
    } as unknown as NonNullable<Parameters<typeof createLiveSync>[0]["desktop"]>;
    const tokens = memTokens();
    await tokens.save("ksync_phone");
    const phone = await device("bbbbbbbbbbbb", server.fetch, clock, {
      tokens,
      phone: true,
      desktop,
    });
    const joined = await phone.sync.services.setUpSync(
      { kind: "server", url: OLD, token: "", kept: true, pinned: FP },
      "join",
      PASS,
      "Phone",
    );
    expect(joined).toMatchObject({ error: null, place: { computer: true } });
    // Linked to its computer, the phone adds no texts and asks no language server there (SY6).
    expect(await phone.sync.languageServer()).toBeNull();

    home = NEW;
    await expect(phone.sync.services.syncNow()).rejects.toThrow(/cannot be reached/);
    // Settings shows the error, and with it Scan the code again.
    expect((await phone.sync.services.syncStatus()).error).toMatch(/cannot be reached/);
    const moved = await phone.sync.services.connectServer(
      { server: NEW, code: "QQQQQ-QQQQQ", pinned: FP },
      "",
    );
    expect(moved).toMatchObject({ error: null, place: { computer: true } });
    // No new pairing: the same token, the code not even used.
    expect(server.paired).toEqual([]);
    expect(tokens.token).toBe("ksync_phone");

    // Another computer's code (another certificate) is not a move.
    await expect(
      phone.sync.services.connectServer(
        { server: NEW, code: "QQQQQ-QQQQQ", pinned: "cd".repeat(32) },
        "",
      ),
    ).rejects.toThrow(/Stop syncing first/);
  });
});
