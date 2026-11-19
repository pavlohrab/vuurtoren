/**
 * The desktop app on this computer only (the default): the data is a SQLite file the app
 * opens natively (`~/Documents/Kenning/kenning.sqlite`), the language server is the bundled
 * sidecar. Everything above the driver (repository, services, screens) is the browser build's.
 *
 */
import type { DataControls, DesktopLocal } from "../shell/AppInfo.js";
import type { AppServices } from "../services/types.js";
import { type DbLock, type DesktopBridge, routeNlpTo } from "./bridge.js";

export type LocalBoot =
  | {
      kind: "app";
      services: AppServices;
      notice?: string;
      data: DataControls;
      desktop: DesktopLocal;
    }
  /** Another computer has the file open (synced folder): ask before opening it here too. */
  | { kind: "locked"; path: string; lock: DbLock; openAnyway: () => Promise<LocalBoot> }
  | { kind: "blocked"; message: string; download: () => Promise<Uint8Array> };

const DEFAULT_NLP_BASE = "kenning-nlp://localhost";

const fileName = (path: string): string => path.split(/[\\/]/).pop() ?? path;

/** The warning for sync-tool conflict copies next to the database. */
export function conflictNotice(path: string, conflicts: string[]): string | undefined {
  if (conflicts.length === 0) return undefined;
  const names = conflicts.map((c) => `“${c}”`).join(", ");
  return `Found ${names} next to your data. A sync tool (Dropbox, OneDrive, Syncthing…) makes such copies when two computers change the file at the same time. Kenning uses ${fileName(path)}; the copy may hold changes from the other computer. Use Kenning on one computer at a time.`;
}

let routed = false;

/** Send `/nlp/...` to the bundled language server (once per page). */
export function installNlpRoute(base: string): void {
  if (routed) return;
  routed = true;
  globalThis.fetch = routeNlpTo(base, globalThis.fetch.bind(globalThis));
}

export async function bootDesktopLocal(
  bridge: DesktopBridge,
  nlpBase: string | undefined,
  force = false,
): Promise<LocalBoot> {
  installNlpRoute(nlpBase ?? DEFAULT_NLP_BASE);
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
  const driver = createNativeDriver(bridge.db);
  let repo;
  try {
    repo = await createRepository(driver);
  } catch (e) {
    if (isSchemaTooNew(e)) {
      return { kind: "blocked", message: e.message, download: () => driver.exportFile() };
    }
    throw e;
  }
  const notice = conflictNotice(opened.path, opened.conflicts);
  return {
    kind: "app",
    services: createLiveServices(repo),
    ...(notice ? { notice } : {}),
    data: {
      mode: "desktop",
      persisted: true,
      persistent: true,
      secure: true,
      admin: createBrowserAdmin(repo, driver),
      file: {
        path: opened.path,
        reveal: () => bridge.db.reveal(),
        move: () => bridge.db.move(),
      },
    },
    desktop: { nlp: bridge.nlp, connectServer: () => bridge.changeServer() },
  };
}
