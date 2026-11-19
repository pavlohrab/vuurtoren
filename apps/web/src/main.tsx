import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import type { ServerHealth } from "@app/db/http";
import { App } from "./App.js";
import { type Account, type AuthClient, createAuthClient } from "./auth/client.js";
import { installFetchWatch } from "./auth/watch.js";
import { desktopBridge, type DesktopBridge } from "./desktop/bridge.js";
import { ConnectScreen } from "./desktop/ConnectScreen.js";
import { type LocalBoot, bootDesktopLocal } from "./desktop/local.js";
import { LockedScreen } from "./desktop/LockedScreen.js";
import { createMockServices } from "./services/mock.js";
import type { AppServices } from "./services/types.js";
import type { AccountControls, DataControls, DesktopLocal } from "./shell/AppInfo.js";
import { SessionGate } from "./shell/SessionGate.js";
import { SignInScreen } from "./shell/SignIn.js";
import {
  BlockedScreen,
  BusyTabScreen,
  ElsewhereScreen,
  UnreachableScreen,
} from "./shell/StorageScreens.js";
import { createBrowserAdmin } from "./storage/browserAdmin.js";
import {
  decideStartup,
  forgetLegacyToken,
  forgetServer,
  rememberServer,
  serverSeen,
} from "./storage/startup.js";
import { acquireTabLock, type HeldLock } from "./storage/tabLock.js";
import { initTheme } from "./theme.js";
import { initPwa } from "./pwa/pwa.js";

initTheme();
initPwa();
// Before any service exists (the NLP client binds fetch when created): a 401 from /api or
// /nlp later on means the session ended, and the sign-in screen comes back.
installFetchWatch();
forgetLegacyToken();
const auth: AuthClient = createAuthClient();

/**
 * Real services by default; `?demo` (or a failure to open the database) uses mock data.
 * Where the data lives: a Kenning API on the same origin (server mode, one SQLite file on the
 * server), else this browser (OPFS).
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
  | {
      kind: "app";
      services: AppServices;
      notice?: string;
      data?: DataControls;
      account?: AccountControls;
      /** Server mode with sign-in: watch for the session ending. */
      session?: { methods: ServerHealth["authMethods"]; user: string | null };
      /** Desktop app on this computer only. */
      desktop?: DesktopLocal;
    }
  | { kind: "signin"; health: ServerHealth }
  | { kind: "unreachable"; reason: string }
  | { kind: "blocked"; message: string; download: () => Promise<Uint8Array> }
  | { kind: "busy"; takeOver: () => Promise<void> }
  | { kind: "elsewhere" }
  /** Desktop app, bundled home page: choose the server. */
  | { kind: "desktop"; bridge: DesktopBridge }
  /** Desktop app, offline: the data file is open on another computer. */
  | Extract<LocalBoot, { kind: "locked" }>;

const INSECURE_NOTICE =
  "Kenning needs https or http://localhost to store data (you opened it over plain http from another device). Use https (see deploy/README.md) or run in server mode.";

/** Server mode: one SQLite file on the server, reached through /api (cookie session). */
async function bootServer(health: ServerHealth, account: Account): Promise<Boot> {
  const [{ createHttpAdmin, createHttpRepository, HttpError }, { createLiveServices }] =
    await Promise.all([import("@app/db/http"), import("./services/live.js")]);
  const admin = createHttpAdmin("");
  try {
    if (health.state === "schema-too-new") {
      return {
        kind: "blocked",
        message: `The database on the server is from a newer Kenning (schema v${health.foundVersion ?? "?"}; this app supports v${health.schemaVersion}).`,
        download: () => admin.exportBackup(),
      };
    }
    const { watchedFetch } = await import("./services/degradedFetch.js");
    const repo = await createHttpRepository("", undefined, watchedFetch);
    return {
      kind: "app",
      services: createLiveServices(repo, { remoteChanged: () => repo.remoteChanged() }),
      data: { mode: "server", persisted: null, persistent: true, secure: isSecureContext, admin },
      account: {
        authEnabled: account.authEnabled,
        user: account.user,
        via: account.via,
        signOut: () => auth.signOut(),
        signOutAll: () => auth.signOutAll(),
      },
      ...(account.authEnabled
        ? { session: { methods: health.authMethods, user: account.user } }
        : {}),
    };
  } catch (e) {
    // Signed out between the check and here: sign in again. Anything else is a server
    // problem; never fall back to browser storage or demo data in server mode.
    if (e instanceof HttpError && e.status === 401) return { kind: "signin", health };
    return {
      kind: "unreachable",
      reason: `The server could not open your data: ${e instanceof Error ? e.message : String(e)}`,
    };
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

/**
 * The desktop app's own page: on this computer only (the default; data in a
 * local SQLite file, the bundled language server), or the Connect screen when the user chose a
 * Kenning server (it then opens the server's page, which boots as usual).
 */
async function bootDesktop(bridge: DesktopBridge): Promise<Boot> {
  const info = await bridge.info().catch(() => null);
  const changing = new URLSearchParams(location.search).has("connect");
  if (changing || info?.mode === "server") return { kind: "desktop", bridge };
  try {
    return await bootDesktopLocal(bridge, info?.nlpBase);
  } catch (e) {
    console.error("The local database could not be opened:", e);
    return {
      kind: "unreachable",
      reason: `Kenning could not open its data file: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

async function boot(): Promise<Boot> {
  const desktop = desktopBridge();
  if (desktop?.home) return bootDesktop(desktop);
  const demo = isDemo();
  // The demo looks like a set-up app: a recent sync, so no "Connect Anki" prompts.
  if (demo)
    return { kind: "app", services: createMockServices({ synced: true, demoLibrary: true }) };
  const { fetchServerHealth } = await import("@app/db/http");
  const start = await decideStartup({
    demo,
    probe: () => fetchServerHealth(),
    me: () => auth.me(),
    serverSeen,
    rememberServer,
  });
  switch (start.kind) {
    case "server":
      return bootServer(start.health, start.account);
    case "signin":
      return { kind: "signin", health: start.health };
    case "unreachable":
      return { kind: "unreachable", reason: start.reason };
    default:
      break;
  }
  // Browser mode (no Kenning API on this origin). Only here can a failure fall back to demo.
  try {
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
    case "app": {
      if (b.notice) console.warn(b.notice);
      const app = (
        <App
          services={b.services}
          notice={b.notice}
          demo={isDemo()}
          onLeaveDemo={leaveDemo}
          data={b.data}
          account={b.account}
          desktop={b.desktop}
        />
      );
      node = b.session ? (
        <SessionGate
          methods={b.session.methods}
          user={b.session.user}
          signIn={(c) => auth.signIn(c)}
        >
          {app}
        </SessionGate>
      ) : (
        app
      );
      break;
    }
    case "signin":
      node = (
        <SignInScreen
          methods={b.health.authMethods ?? ["token"]}
          signIn={(c) => auth.signIn(c)}
          onSignedIn={() => void boot().then(show)}
        />
      );
      break;
    case "unreachable":
      node = (
        <UnreachableScreen
          reason={b.reason}
          onForget={() => {
            forgetServer();
            location.reload();
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
    case "locked":
      node = (
        <LockedScreen
          path={b.path}
          lock={b.lock}
          onOpenAnyway={async () => show(await b.openAnyway())}
        />
      );
      break;
    case "desktop":
      node = (
        <ConnectScreen
          bridge={b.bridge}
          changing={new URLSearchParams(location.search).has("connect")}
        />
      );
      break;
  }
  reactRoot.render(<StrictMode>{node}</StrictMode>);
  return Promise.resolve();
}

void boot().then(show);
