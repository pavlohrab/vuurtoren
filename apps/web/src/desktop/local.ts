/**
 * The app: the data is a SQLite file the app opens natively (on a computer
 * `~/Documents/Vuurtoren/vuurtoren.sqlite`, on a phone in the app's private storage). On a
 * computer the language server is the bundled sidecar; a phone uses its sync server's.
 * Everything above the driver (repository, services, screens) is the browser build's.
 */
import { compactNowAndThen, mark, timed } from "../perf/speed.js";
import type { DataControls, DesktopLocal } from "../shell/AppInfo.js";
import type { AppServices } from "../services/types.js";
import { type DbLock, type DesktopBridge, routeNlpTo } from "./bridge.js";

export type LocalBoot =
  | {
      kind: "app";
      services: AppServices;
      notice?: string;
      data: DataControls;
      /** A computer (a phone has no bundled language server). */
      desktop?: DesktopLocal;
    }
  /** Another computer has the file open (synced folder): ask before opening it here too. */
  | { kind: "locked"; path: string; lock: DbLock; openAnyway: () => Promise<LocalBoot> }
  | { kind: "blocked"; message: string; download: () => Promise<Uint8Array> };

const DEFAULT_NLP_BASE = "vuurtoren-nlp://localhost";

const fileName = (path: string): string => path.split(/[\\/]/).pop() ?? path;

/** The warning for sync-tool conflict copies next to the database. */
export function conflictNotice(path: string, conflicts: string[]): string | undefined {
  if (conflicts.length === 0) return undefined;
  const names = conflicts.map((c) => `“${c}”`).join(", ");
  return `Found ${names} next to your data. A sync tool (Dropbox, OneDrive, Syncthing…) makes such copies when two computers change the file at the same time. Vuurtoren uses ${fileName(path)}; the copy may hold changes from the other computer. Use Vuurtoren on one computer at a time.`;
}

let routed = false;

/** Send `/nlp/...` to the bundled language server (once per page). */
function installNlpRoute(base: string): void {
  if (routed) return;
  routed = true;
  globalThis.fetch = routeNlpTo(base, globalThis.fetch.bind(globalThis));
}

export async function bootDesktopLocal(
  bridge: DesktopBridge,
  nlpBase: string | null | undefined,
  force = false,
): Promise<LocalBoot> {
  const phone = bridge.os === "android";
  // A phone has no language server of its own: `/nlp` stays the sync server's (liveSync).
  if (!phone) installNlpRoute(nlpBase ?? DEFAULT_NLP_BASE);
  const opened = await bridge.db.open(force);
  if (opened.locked) {
    return {
      kind: "locked",
      path: opened.path,
      lock: opened.locked,
      openAnyway: () => bootDesktopLocal(bridge, nlpBase, true),
    };
  }
  const [{ createRepository, isSchemaTooNew }, { createNativeDriver }, { createLiveServices }] =
    await Promise.all([import("@app/db"), import("@app/db/native"), import("../services/live.js")]);
  const { createBrowserAdmin } = await import("../storage/browserAdmin.js");
  mark("code loaded");
  const driver = createNativeDriver(timed(bridge.db, "db"));
  let repo;
  try {
    repo = await createRepository(driver);
    mark("database open (and caught up)");
    compactNowAndThen(repo);
  } catch (e) {
    if (isSchemaTooNew(e)) {
      return { kind: "blocked", message: e.message, download: () => driver.exportFile() };
    }
    throw e;
  }
  const notice = conflictNotice(opened.path, opened.conflicts);
  return {
    kind: "app",
    services: timed(createLiveServices(repo), "services"),
    ...(notice ? { notice } : {}),
    data: {
      mode: phone ? "phone" : "desktop",
      persisted: true,
      persistent: true,
      secure: true,
      admin: createBrowserAdmin(repo, driver),
      // The file of a phone's app is private: nothing to show or move.
      ...(phone
        ? {}
        : {
            file: {
              path: opened.path,
              reveal: () => bridge.db.reveal(),
              move: () => bridge.db.move(),
            },
          }),
    },
    ...(phone ? {} : { desktop: { nlp: bridge.nlp } }),
  };
}
