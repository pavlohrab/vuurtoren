/**
 * New versions for the Android app from GitHub (TR12). The computer app updates itself (the
 * Tauri updater); a store build (`VUURTOREN_STORE=play` at build time) is updated by its store.
 * For the APK from GitHub: at most once a day ask GitHub for the latest release, and when it is
 * newer than this app, Read shows a quiet card (UpdateCard). Not now hides it until the next
 * version. Settings can turn the check off. The state is per device (localStorage).
 */
import { currentDevice } from "./platform/index.js";
import { APP_VERSION, APP_STORE } from "./version.js";

export const LATEST_RELEASE = "https://api.github.com/repos/pavlohrab/Vuurtoren/releases/latest";
export const RELEASES_PAGE = "https://github.com/pavlohrab/Vuurtoren/releases/latest";

const KEY = "vuurtoren-updates";
const DAY = 24 * 60 * 60 * 1000;

export interface UpdateState {
  /** Off in Settings. */
  off?: boolean;
  /** When GitHub was last asked (ms). */
  checkedAt?: number;
  /** The newest version GitHub gave ("0.3.0"). */
  latest?: string;
  /** The version Not now was pressed for. */
  dismissed?: string;
}

export function readUpdates(): UpdateState {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as UpdateState;
  } catch {
    return {};
  }
}

export function writeUpdates(state: UpdateState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // No storage (a private window): the card just comes back next time.
  }
}

/** Does this build check GitHub at all? The Android app from GitHub only. */
export function checksForUpdates(): boolean {
  return currentDevice().kind === "android" && APP_STORE === "";
}

/** "v0.3.0" → [0, 3, 0]; anything after the numbers ("-beta") is left out. */
function parts(v: string): number[] {
  return (v.replace(/^v/, "").match(/^\d+(\.\d+)*/)?.[0] ?? "0").split(".").map(Number);
}

/** Is version `a` newer than `b`? */
export function isNewer(a: string, b: string): boolean {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d > 0;
  }
  return false;
}

/**
 * The newer version to tell about, or null. Asks GitHub at most once a day (otherwise uses the
 * last answer); a failed request is quiet and tried again the next day.
 */
export async function newVersion(
  now = Date.now(),
  fetchImpl: typeof fetch = fetch,
  current = APP_VERSION,
): Promise<string | null> {
  let state = readUpdates();
  if (state.off) return null;
  if (!state.checkedAt || now - state.checkedAt >= DAY) {
    state = { ...state, checkedAt: now };
    try {
      const res = await fetchImpl(LATEST_RELEASE, {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (res.ok) {
        const tag = ((await res.json()) as { tag_name?: string }).tag_name;
        if (tag) state.latest = tag.replace(/^v/, "");
      }
    } catch {
      // Offline: ask again tomorrow.
    }
    writeUpdates(state);
  }
  const { latest, dismissed } = state;
  if (!latest || !isNewer(latest, current) || latest === dismissed) return null;
  return latest;
}
