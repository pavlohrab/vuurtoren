import { describe, expect, it } from "vitest";
import type { ServerHealth } from "@app/db/http";
import type { Account } from "../auth/client.js";
import { decideStartup, type StartupDeps } from "./startup.js";
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
const locked: ServerHealth = { ...health, authRequired: true, authMethods: ["password"] };
const anna: Account = { authEnabled: true, user: "anna", via: "session" };

function deps(over: Partial<StartupDeps> = {}): StartupDeps & { remembered: number } {
  const d = {
    remembered: 0,
    demo: false,
    probe: () => Promise.resolve(health),
    me: () => Promise.resolve(anna),
    serverSeen: () => false,
    rememberServer: () => void d.remembered++,
    ...over,
  };
  return d;
}

describe("decideStartup", () => {
  it("uses the server when the API answers (and remembers it)", async () => {
    const d = deps();
    expect(await decideStartup(d)).toMatchObject({ kind: "server", health });
    expect(d.remembered).toBe(1);
  });

  it("uses browser storage when nothing answers on a fresh browser", async () => {
    expect(await decideStartup(deps({ probe: () => Promise.resolve(null) }))).toEqual({
      kind: "browser",
    });
  });

  it("demo wins over everything", async () => {
    expect(await decideStartup(deps({ demo: true }))).toEqual({ kind: "demo" });
  });

  it("signed out (401) shows sign-in and never falls back to browser storage", async () => {
    const r = await decideStartup(
      deps({ probe: () => Promise.resolve(locked), me: () => Promise.resolve(null) }),
    );
    expect(r).toEqual({ kind: "signin", health: locked });
  });

  it("signed in opens the server with the account", async () => {
    const r = await decideStartup(deps({ probe: () => Promise.resolve(locked) }));
    expect(r).toEqual({ kind: "server", health: locked, account: anna });
  });

  it("a failing sign-in check is an outage, not a reason to use local storage", async () => {
    const r = await decideStartup(
      deps({ probe: () => Promise.resolve(locked), me: () => Promise.reject(new Error("502")) }),
    );
    expect(r).toEqual({ kind: "unreachable", reason: "502" });
  });

  it("a server seen before that does not answer is reported, not replaced", async () => {
    const r = await decideStartup(
      deps({ probe: () => Promise.resolve(null), serverSeen: () => true }),
    );
    expect(r.kind).toBe("unreachable");
  });

  it("auth off: no sign-in check at all", async () => {
    let asked = false;
    const r = await decideStartup(
      deps({
        me: () => {
          asked = true;
          return Promise.resolve(null);
        },
      }),
    );
    expect(r).toMatchObject({ kind: "server", account: { authEnabled: false } });
    expect(asked).toBe(false);
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
