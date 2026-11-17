import { describe, expect, it } from "vitest";
import type { ServerHealth } from "@app/db/http";
import { selectStorageMode } from "./mode.js";
import {
  type ChannelLike,
  type LockManagerLike,
  type TabLockDeps,
  acquireTabLock,
} from "./tabLock.js";

const health: ServerHealth = {
  ok: true,
  service: "kenning-api",
  state: "ready",
  authRequired: false,
  schemaVersion: 3,
};

describe("selectStorageMode", () => {
  it("uses the server when the API answers", () => {
    expect(selectStorageMode({ demo: false, health })).toEqual({ kind: "server", health });
  });
  it("falls back to the browser when nothing answers", () => {
    expect(selectStorageMode({ demo: false, health: null })).toEqual({ kind: "browser" });
  });
  it("demo wins over everything", () => {
    expect(selectStorageMode({ demo: true, health })).toEqual({ kind: "demo" });
    expect(selectStorageMode({ demo: true, health: null })).toEqual({ kind: "demo" });
  });
});

/** Minimal Web Locks + BroadcastChannel fakes shared by "tabs" in one test. */
function fakeBrowser(): { tab: () => TabLockDeps } {
  let holder = false;
  const waiting: (() => void)[] = [];
  const grant = (cb: (l: object | null) => unknown): Promise<unknown> => {
    holder = true;
    return Promise.resolve(cb({})).finally(() => {
      holder = false;
      waiting.shift()?.();
    });
  };
  const locks: LockManagerLike = {
    request(_name, options, cb) {
      if (!holder) return grant(cb);
      if (options.ifAvailable) return Promise.resolve(cb(null));
      return new Promise((resolve, reject) => {
        options.signal?.addEventListener("abort", () => reject(new Error("timeout")));
        waiting.push(() => resolve(grant(cb)));
      });
    },
  };
  const channels = new Set<{ fn: (ev: { data: unknown }) => void; owner: object }>();
  return {
    tab: () => {
      const owner = {};
      return {
        locks,
        openChannel: (): ChannelLike => {
          const me: { fn: (ev: { data: unknown }) => void; owner: object } = {
            fn: () => undefined,
            owner,
          };
          return {
            postMessage(m) {
              for (const c of [...channels]) if (c.owner !== owner) c.fn({ data: m });
            },
            addEventListener(_t, fn) {
              me.fn = fn;
              channels.add(me);
            },
            close() {
              channels.delete(me);
            },
          };
        },
      };
    },
  };
}

describe("tab lock", () => {
  it("skips the guard where Web Locks are unavailable", async () => {
    const r = await acquireTabLock({ locks: undefined, openChannel: () => ({}) as ChannelLike });
    expect(r.status).toBe("acquired");
  });

  it("the first tab acquires, the second is busy", async () => {
    const b = fakeBrowser();
    expect((await acquireTabLock(b.tab())).status).toBe("acquired");
    expect((await acquireTabLock(b.tab())).status).toBe("busy");
  });

  it("'use here instead' makes the holder let go and acquires the lock", async () => {
    const b = fakeBrowser();
    const first = await acquireTabLock(b.tab());
    if (first.status !== "acquired") throw new Error("expected the lock");
    let notified = 0;
    first.lock.onTakenOver(() => notified++);
    const second = await acquireTabLock(b.tab());
    if (second.status !== "busy") throw new Error("expected busy");
    await second.busy.takeOver();
    expect(notified).toBe(1);
    // now a third tab sees it busy again (the second tab holds it)
    expect((await acquireTabLock(b.tab())).status).toBe("busy");
  });

  it("gives up when the holder never releases", async () => {
    const b = fakeBrowser();
    await acquireTabLock(b.tab());
    const t = b.tab();
    // This tab's release request never reaches the holder.
    const second = await acquireTabLock({
      ...t,
      openChannel: () => ({ postMessage() {}, addEventListener() {}, close() {} }),
    });
    if (second.status !== "busy") throw new Error("expected busy");
    await expect(second.busy.takeOver(20)).rejects.toThrow();
  });
});
