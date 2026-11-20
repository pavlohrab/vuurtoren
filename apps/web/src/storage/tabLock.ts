/**
 * Single-tab guard for browser mode. OPFS access handles are exclusive, so a second tab
 * cannot open the database. The Web Locks API tells us who holds it; a BroadcastChannel lets
 * the newer tab ask the holder to let go ("Use here instead").
 */

/** The part of `navigator.locks` we use. */
export interface LockManagerLike {
  request(
    name: string,
    options: { ifAvailable?: boolean; signal?: AbortSignal },
    callback: (lock: object | null) => Promise<unknown> | unknown,
  ): Promise<unknown>;
}

/** The part of `BroadcastChannel` we use. */
export interface ChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: "message", fn: (ev: { data: unknown }) => void): void;
  close(): void;
}

export interface TabLockDeps {
  locks: LockManagerLike | undefined;
  openChannel: (name: string) => ChannelLike;
}

const LOCK_NAME = "vuurtoren-db";
const CHANNEL_NAME = "vuurtoren-db";
const RELEASE_MESSAGE = "release";

/** This tab owns the database. */
export interface HeldLock {
  /** Register what to do when another tab asks us to let go (the lock is released after). */
  onTakenOver(fn: () => void): void;
}

/** Another tab owns it; `takeOver` asks it to release and waits for the lock. */
export interface BusyLock {
  takeOver(timeoutMs?: number): Promise<HeldLock>;
}

/** Production dependencies from `navigator` (`locks` undefined where unsupported). */
function browserTabLockDeps(): TabLockDeps {
  return {
    locks: typeof navigator !== "undefined" ? navigator.locks : undefined,
    openChannel: (name) => new BroadcastChannel(name),
  };
}

/**
 * Request the lock and hold it until another tab asks for it.
 * Resolves null when `ifAvailable` is set and somebody else holds the lock.
 */
function hold(
  locks: LockManagerLike,
  deps: TabLockDeps,
  options: { ifAvailable?: boolean; signal?: AbortSignal },
): Promise<HeldLock | null> {
  return new Promise((resolve, reject) => {
    let release: () => void = () => undefined;
    let handler: (() => void) | null = null;
    locks
      .request(LOCK_NAME, options, (lock) => {
        if (!lock) {
          resolve(null);
          return undefined;
        }
        const channel = deps.openChannel(CHANNEL_NAME);
        channel.addEventListener("message", (ev) => {
          if (ev.data !== RELEASE_MESSAGE) return;
          handler?.();
          release();
          channel.close();
        });
        resolve({
          onTakenOver(fn) {
            handler = fn;
          },
        });
        return new Promise<void>((r) => {
          release = r;
        });
      })
      .catch((err: unknown) => reject(err instanceof Error ? err : new Error(String(err))));
  });
}

/**
 * Try to become the one tab that owns the database. Without the Web Locks API (or if it
 * misbehaves) the guard is skipped and the tab counts as the owner.
 */
export async function acquireTabLock(
  deps: TabLockDeps = browserTabLockDeps(),
): Promise<{ status: "acquired"; lock: HeldLock } | { status: "busy"; busy: BusyLock }> {
  const none: HeldLock = { onTakenOver: () => undefined };
  const locks = deps.locks;
  if (!locks) return { status: "acquired", lock: none };
  let held: HeldLock | null;
  try {
    held = await hold(locks, deps, { ifAvailable: true });
  } catch {
    // Web Locks unavailable (old browser): run without the single-tab guard (expected)
    return { status: "acquired", lock: none };
  }
  if (held) return { status: "acquired", lock: held };
  return {
    status: "busy",
    busy: {
      async takeOver(timeoutMs = 5000) {
        const ask = deps.openChannel(CHANNEL_NAME);
        ask.postMessage(RELEASE_MESSAGE);
        ask.close();
        const got = await hold(locks, deps, { signal: AbortSignal.timeout(timeoutMs) });
        return got ?? none;
      },
    },
  };
}
