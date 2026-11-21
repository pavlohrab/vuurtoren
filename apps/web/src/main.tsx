import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App.js";
import {
  type Account,
  type AuthClient,
  type ServerHealth,
  createAuthClient,
  fetchServerHealth,
} from "./auth/client.js";
import { createSyncTokenClient } from "./auth/tokens.js";
import { installFetchWatch } from "./auth/watch.js";
import { desktopBridge, type DesktopBridge } from "./desktop/bridge.js";
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
  StartFailedScreen,
} from "./shell/StorageScreens.js";
import { createBrowserAdmin } from "./storage/browserAdmin.js";
import { decideStartup, forgetLegacyToken } from "./storage/startup.js";
import { acquireTabLock, type HeldLock } from "./storage/tabLock.js";
import { initTheme } from "./theme.js";
import { initPwa } from "./pwa/pwa.js";
import { installNativeInsets } from "./platform/insets.js";
import { watchKeyboard } from "./keyboardHints.js";

initTheme();
initPwa();
installNativeInsets();
watchKeyboard();
// Before any service exists (the NLP client binds fetch when created): a 401 from /api or
// /nlp later on means the session ended, and the sign-in screen comes back.
installFetchWatch();
forgetLegacyToken();
const auth: AuthClient = createAuthClient();

/**
 * Real services by default; `?demo` (or a failure to open the database) uses mock data. The data
 * lives on this device: the desktop app's file, or this browser (OPFS). A page served by a
 * Vuurtoren server signs in to it first, and can sync through it.
 */
const DEMO_KEY = "vuurtoren-demo";

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
      /** A page of a Vuurtoren server with sign-in: watch for the session ending. */
      session?: { methods: ServerHealth["authMethods"]; user: string | null };
      /** The desktop app. */
      desktop?: DesktopLocal;
    }
  | { kind: "signin"; health: ServerHealth }
  | { kind: "failed"; reason: string }
  | { kind: "blocked"; message: string; download: () => Promise<Uint8Array> }
  | { kind: "busy"; takeOver: () => Promise<void> }
  | { kind: "elsewhere" }
  /** Desktop app: the data file is open on another computer. */
  | Extract<LocalBoot, { kind: "locked" }>;

/** The Vuurtoren server this page comes from, signed in (or with sign-in off). */
type PageServer = { health: ServerHealth; account: Account };

const INSECURE_NOTICE =
  "Vuurtoren needs https or http://localhost to store data (you opened it over plain http from another device). Use https (see deploy/README.md).";

/** How long closing the page waits for the last sync before it lets go of the database. */
const LEAVE_WAIT_MS = 3_000;

/** Browser mode: SQLite in OPFS, owned by exactly one tab. */
async function bootBrowser(server: PageServer | null): Promise<Boot> {
  const tab = await acquireTabLock();
  if (tab.status === "busy") {
    return {
      kind: "busy",
      takeOver: async () => show(await openBrowser(await tab.busy.takeOver(), server)),
    };
  }
  return openBrowser(tab.lock, server);
}

async function openBrowser(lock: HeldLock, server: PageServer | null): Promise<Boot> {
  const [{ createRepository, isSchemaTooNew }, { createWebDriver }, { createLiveServices }] =
    await Promise.all([import("@app/db"), import("@app/db/web"), import("./services/live.js")]);
  const driver = await createWebDriver("vuurtoren");
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
  const tokens = createSyncTokenClient();
  const services = createLiveServices(repo, {
    server: server
      ? {
          origin: location.origin,
          newToken: async (label) => (await tokens.create(label, true)).token,
        }
      : undefined,
  });
  // OPFS access handles are exclusive. Release them when the page goes (including the
  // back/forward cache, which keeps frozen pages alive), and reopen by reloading if a frozen
  // page is restored; otherwise the next page load could not open the database. The last sync
  // (started when the page was hidden) finishes first, or gets a few seconds.
  addEventListener("pagehide", () => {
    const leaving = services.syncBeforeLeaving?.() ?? Promise.resolve();
    const waited = new Promise((r) => setTimeout(r, LEAVE_WAIT_MS));
    void Promise.race([leaving, waited]).finally(() => driver.terminate());
  });
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
  const account = server?.account;
  return {
    kind: "app",
    services,
    ...(notice ? { notice } : {}),
    data: {
      mode: "browser",
      persisted,
      persistent: driver.persistent,
      secure,
      admin: createBrowserAdmin(repo, driver),
    },
    ...(account
      ? {
          account: {
            authEnabled: account.authEnabled,
            user: account.user,
            via: account.via,
            signOut: () => auth.signOut(),
            signOutAll: () => auth.signOutAll(),
          },
        }
      : {}),
    ...(server && account?.authEnabled
      ? { session: { methods: server.health.authMethods, user: account.user } }
      : {}),
  };
}

/** The desktop app: data in a local SQLite file, the bundled language server. */
async function bootDesktop(bridge: DesktopBridge): Promise<Boot> {
  const info = await bridge.info().catch(() => null);
  try {
    return await bootDesktopLocal(bridge, info?.nlpBase);
  } catch (e) {
    console.error("The local database could not be opened:", e);
    return {
      kind: "failed",
      reason: `Vuurtoren could not open its data file: ${e instanceof Error ? e.message : String(e)}`,
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
  const start = await decideStartup({
    demo,
    probe: () => fetchServerHealth(),
    me: () => auth.me(),
  });
  if (start.kind === "signin") return { kind: "signin", health: start.health };
  try {
    return await bootBrowser(start.kind === "browser" ? start.server : null);
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
    case "failed":
      node = <StartFailedScreen reason={b.reason} />;
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
  }
  reactRoot.render(<StrictMode>{node}</StrictMode>);
  return Promise.resolve();
}

void boot().then(show);
