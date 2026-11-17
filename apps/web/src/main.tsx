import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import type { ServerHealth } from "@app/db/http";
import { App } from "./App.js";
import { createMockServices } from "./services/mock.js";
import type { AppServices } from "./services/types.js";
import type { DataControls } from "./shell/AppInfo.js";
import {
  BlockedScreen,
  BusyTabScreen,
  ElsewhereScreen,
  LoginScreen,
} from "./shell/StorageScreens.js";
import { createBrowserAdmin } from "./storage/browserAdmin.js";
import { loadToken, saveToken, selectStorageMode } from "./storage/mode.js";
import { acquireTabLock, type HeldLock } from "./storage/tabLock.js";
import { initTheme } from "./theme.js";

initTheme();

/**
 * Real services by default; `?demo` (or a failure to open the database) uses mock data.
 * Where the data lives: a Kenning API on the same origin (server mode, one SQLite file on the
 * server), else this browser (OPFS). See docs/adr/0008-server-storage-mode.md.
 */
const DEMO_KEY = "kenning-demo";

/**
 * Demo mode is requested with `?demo` and remembered for the browser session, so in-app
 * navigation (which drops the query string) and reloads stay in demo.
 */
function isDemo(): boolean {
  const asked = new URLSearchParams(location.search).has("demo");
  try {
    if (asked) sessionStorage.setItem(DEMO_KEY, "1");
    return asked || sessionStorage.getItem(DEMO_KEY) === "1";
  } catch {
    return asked;
  }
}

/** Leave demo mode: forget the flag and reload without `?demo`, which opens the real data. */
function leaveDemo(): void {
  try {
    sessionStorage.removeItem(DEMO_KEY);
  } catch {
    /* nothing to forget */
  }
  location.assign(location.pathname);
}

/** What to show after trying to open the user's data. */
type Boot =
  | { kind: "app"; services: AppServices; notice?: string; data?: DataControls }
  | { kind: "login"; error?: string }
  | { kind: "blocked"; message: string; download: () => Promise<Uint8Array> }
  | { kind: "busy"; takeOver: () => Promise<void> }
  | { kind: "elsewhere" };

const INSECURE_NOTICE =
  "Kenning needs https or http://localhost to store data (you opened it over plain http from another device). Use https (see deploy/README.md) or run in server mode.";

/** Server mode: one SQLite file on the server, reached through /api. */
async function bootServer(health: ServerHealth, token: string | null): Promise<Boot> {
  const [{ createHttpAdmin, createHttpRepository, HttpError }, { createLiveServices }] =
    await Promise.all([import("@app/db/http"), import("./services/live.js")]);
  const admin = createHttpAdmin("", token ?? undefined);
  try {
    if (health.authRequired) await admin.info(); // verifies the token
    if (health.state === "schema-too-new") {
      return {
        kind: "blocked",
        message: `The database on the server is from a newer Kenning (schema v${health.foundVersion ?? "?"}; this app supports v${health.schemaVersion}).`,
        download: () => admin.exportBackup(),
      };
    }
    const repo = await createHttpRepository("", token ?? undefined);
    return {
      kind: "app",
      services: createLiveServices(repo),
      data: { mode: "server", persisted: null, persistent: true, secure: isSecureContext, admin },
    };
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) {
      return { kind: "login", ...(token ? { error: "That token was not accepted." } : {}) };
    }
    throw e;
  }
}

/** Browser mode: SQLite in OPFS, owned by exactly one tab. */
async function bootBrowser(): Promise<Boot> {
  const tab = await acquireTabLock();
  if (tab.status === "busy") {
    return {
      kind: "busy",
      takeOver: async () => show(await openBrowser(await tab.busy.takeOver())),
    };
  }
  return openBrowser(tab.lock);
}

async function openBrowser(lock: HeldLock): Promise<Boot> {
  const [{ createRepository, isSchemaTooNew }, { createWebDriver }, { createLiveServices }] =
    await Promise.all([import("@app/db"), import("@app/db/web"), import("./services/live.js")]);
  const driver = await createWebDriver("kenning");
  // Another tab may ask for the database ("Use here instead"): let go of OPFS at once.
  lock.onTakenOver(() => {
    driver.terminate();
    void show({ kind: "elsewhere" });
  });
  let repo;
  try {
    repo = await createRepository(driver);
  } catch (e) {
    // A database from a newer app must never be replaced by demo data.
    if (isSchemaTooNew(e)) {
      return { kind: "blocked", message: e.message, download: () => driver.exportFile() };
    }
    throw e;
  }
  // OPFS access handles are exclusive. Release them when the page is hidden (including the
  // back/forward cache, which keeps frozen pages alive), and reopen by reloading if a frozen
  // page is restored; otherwise the next page load could not open the database.
  addEventListener("pagehide", () => driver.terminate());
  addEventListener("pageshow", (e) => {
    if (e.persisted) location.reload();
  });
  // Ask the browser not to evict the data under storage pressure.
  const persisted: boolean | null = await Promise.resolve(navigator.storage?.persist?.()).then(
    (granted) => granted ?? null,
    () => null,
  );
  const secure = isSecureContext;
  const notice = !secure
    ? INSECURE_NOTICE
    : driver.persistent
      ? undefined
      : "Your browser does not allow local storage here (private window), so data will not be saved.";
  return {
    kind: "app",
    services: createLiveServices(repo),
    ...(notice ? { notice } : {}),
    data: {
      mode: "browser",
      persisted,
      persistent: driver.persistent,
      secure,
      admin: createBrowserAdmin(repo, driver),
    },
  };
}

async function boot(): Promise<Boot> {
  const demo = isDemo();
  if (demo) return { kind: "app", services: createMockServices() };
  try {
    const { fetchServerHealth } = await import("@app/db/http");
    const mode = selectStorageMode({ demo, health: await fetchServerHealth() });
    if (mode.kind === "server") return await bootServer(mode.health, loadToken());
    return await bootBrowser();
  } catch (e) {
    console.error("Falling back to demo data:", e);
    return {
      kind: "app",
      services: createMockServices(),
      notice: "The database could not be opened, so demo data is shown.",
    };
  }
}

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
const reactRoot = createRoot(root);

/** Render a boot result (also used again after "Use here instead" or a login). */
function show(b: Boot): Promise<void> {
  let node: ReactNode;
  switch (b.kind) {
    case "app":
      if (b.notice) console.warn(b.notice);
      node = (
        <App
          services={b.services}
          notice={b.notice}
          demo={isDemo()}
          onLeaveDemo={leaveDemo}
          data={b.data}
        />
      );
      break;
    case "login":
      node = (
        <LoginScreen
          error={b.error}
          onSubmit={(token) => {
            saveToken(token);
            void boot().then(show);
          }}
        />
      );
      break;
    case "blocked":
      node = <BlockedScreen message={b.message} download={b.download} />;
      break;
    case "busy":
      node = <BusyTabScreen onUseHere={b.takeOver} />;
      break;
    case "elsewhere":
      node = <ElsewhereScreen />;
      break;
  }
  reactRoot.render(<StrictMode>{node}</StrictMode>);
  return Promise.resolve();
}

void boot().then(show);
