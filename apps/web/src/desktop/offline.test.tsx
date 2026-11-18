import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNodeSyncDb } from "@app/db/node";
import { App } from "../App.js";
import { createMockServices } from "../services/mock.js";
import type { DesktopLocal } from "../shell/AppInfo.js";
import type { DesktopBridge, SidecarStatus } from "./bridge.js";
import { routeNlpTo } from "./bridge.js";
import { ago } from "./LockedScreen.js";
import { bootDesktopLocal, conflictNotice } from "./local.js";
import { mb, ocrAvailable, setupView } from "./setup.js";

const ready = (health: SidecarStatus["health"]): SidecarStatus => ({ state: "ready", health });

const downloading: SidecarStatus = ready({
  ocr: false,
  packs: {
    busy: true,
    items: {
      "dictionary-nl": {
        state: "missing",
        activity: "downloading",
        size: 14_073_216,
        received: 7_036_608,
      },
      "sentences-nl": { state: "missing", size: 20_013_862 },
    },
  },
});

describe("first-run card wording", () => {
  it("follows the language server from start to ready", () => {
    expect(setupView(null)).toBeNull();
    expect(setupView({ state: "starting", health: null })?.message).toBe(
      "Starting the language tools…",
    );
    const dl = setupView(downloading);
    expect(dl).toEqual({
      tone: "progress",
      message: "Downloading the Dutch dictionary… 14 MB",
      progress: 0.5,
    });
    expect(
      setupView(
        ready({
          packs: {
            busy: true,
            items: { "mt-nl-en": { state: "missing", activity: "installing" } },
          },
        }),
      )?.message,
    ).toBe("Installing the translation model…");
    expect(
      setupView(
        ready({
          packs: {
            busy: true,
            items: { "grammar-examples-nl": { state: "missing", activity: "building" } },
          },
        }),
      )?.message,
    ).toBe("Preparing grammar examples…");
    expect(
      setupView(ready({ packs: { busy: false, items: { "dictionary-nl": { state: "ok" } } } })),
    ).toBeNull();
  });

  it("offers a retry for a failed download and a restart for a failed start", () => {
    const failed = setupView(
      ready({
        packs: {
          busy: false,
          items: { "sentences-nl": { state: "missing", activity: "error: timed out" } },
        },
      }),
    );
    expect(failed?.action).toBe("retry-packs");
    expect(failed?.message).toMatch(/Could not download example sentences/);
    const crash = setupView({ state: "failed", error: "It stopped.", health: null });
    expect(crash).toMatchObject({ tone: "error", action: "restart" });
    expect(mb(14_073_216)).toBe("14 MB");
    expect(mb(10)).toBe("1 MB");
  });

  it("reads OCR availability from /health", () => {
    expect(ocrAvailable(downloading)).toBe(false);
    expect(ocrAvailable(ready({ ocr: true }))).toBe(true);
    expect(ocrAvailable(null)).toBe(false);
  });
});

describe("the /nlp route in offline mode", () => {
  it("sends /nlp to the bundled language server and leaves everything else alone", async () => {
    const seen: string[] = [];
    const fallback = vi.fn((input: RequestInfo | URL) => {
      seen.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      return Promise.resolve(new Response("{}"));
    });
    const f = routeNlpTo("kenning-nlp://localhost/", fallback);
    await f("/nlp/analyze/text", { method: "POST" });
    await f(`${location.origin}/nlp/grammar/examples?topic=x`);
    await f("/nlp");
    await f("/nlpx/other");
    await f("http://127.0.0.1:8765");
    await f("https://example.com/nlp/x");
    expect(seen).toEqual([
      "kenning-nlp://localhost/analyze/text",
      "kenning-nlp://localhost/grammar/examples?topic=x",
      "kenning-nlp://localhost/",
      "/nlpx/other",
      "http://127.0.0.1:8765",
      "https://example.com/nlp/x",
    ]);
  });
});

describe("lock and sync warnings", () => {
  it("names conflict copies calmly", () => {
    expect(conflictNotice("/d/kenning.sqlite", [])).toBeUndefined();
    expect(conflictNotice("/d/kenning.sqlite", ["kenning (1).sqlite"])).toMatch(
      /Found “kenning \(1\)\.sqlite” next to your data.*Kenning uses kenning\.sqlite/,
    );
    expect(ago(1000, 1030)).toBe("just now");
    expect(ago(0, 600)).toBe("10 minutes ago");
    expect(ago(0, 7200)).toBe("2 hours ago");
    expect(ago(0, 86400 * 3)).toBe("3 days ago");
  });
});

/** The app's database commands on a real SQLite file (node:sqlite), JSON on the wire. */
function nodeDb(file: string): DesktopBridge["db"] {
  const db = createNodeSyncDb(file);
  return {
    open: vi.fn(() => Promise.resolve({ path: file, created: true, conflicts: [], locked: null })),
    exec: (sql, params) => Promise.resolve(db.exec(sql, params as never[]) as unknown[]),
    close: () => Promise.resolve(db.close()),
    exportFile: () => Promise.resolve(new Uint8Array(readFileSync(file))),
    importFile: () => Promise.resolve(),
    reveal: vi.fn(() => Promise.resolve()),
    move: vi.fn(() => Promise.resolve(null)),
  };
}

function bridgeWith(db: DesktopBridge["db"], status: SidecarStatus = downloading): DesktopBridge {
  return {
    home: true,
    info: () => Promise.resolve({ version: "0.2.0", serverUrl: null, mode: "local" }),
    checkServer: vi.fn(),
    connect: vi.fn(),
    changeServer: vi.fn(() => Promise.resolve()),
    ankiFetch: vi.fn(() => Promise.reject(new Error("not running"))),
    useLocal: vi.fn(),
    db,
    nlp: {
      status: vi.fn(() => Promise.resolve(status)),
      restart: vi.fn(() => Promise.resolve()),
      retryPacks: vi.fn(() => Promise.resolve()),
    },
  };
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("first start on this computer", () => {
  it("opens the data file through the app and reports where it is", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "kenning-desk-")), "kenning.sqlite");
    const bridge = bridgeWith(nodeDb(file));
    const boot = await bootDesktopLocal(bridge, "kenning-nlp://localhost");
    expect(boot.kind).toBe("app");
    if (boot.kind !== "app") return;
    expect(boot.data.mode).toBe("desktop");
    expect(boot.data.file?.path).toBe(file);
    expect(bridge.db.open).toHaveBeenCalledWith(false);
    // Migrations ran on the file: it is a Kenning database now.
    const info = await boot.data.admin.info();
    expect(info.deviceId).toBeTruthy();
    expect(boot.notice).toBeUndefined();
  });

  it("stops at the lock of another computer and opens on request", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "kenning-desk-")), "kenning.sqlite");
    const db = nodeDb(file);
    const lock = { host: "laptop", pid: 9, since: 1, seen: 2 };
    db.open = vi.fn((force?: boolean) =>
      Promise.resolve({
        path: file,
        created: false,
        conflicts: ["kenning (1).sqlite"],
        locked: force ? null : lock,
      }),
    );
    const boot = await bootDesktopLocal(bridgeWith(db), undefined);
    expect(boot).toMatchObject({ kind: "locked", lock, path: file });
    if (boot.kind !== "locked") return;
    const again = await boot.openAnyway();
    expect(db.open).toHaveBeenLastCalledWith(true);
    expect(again.kind).toBe("app");
    if (again.kind === "app") expect(again.notice).toMatch(/kenning \(1\)\.sqlite/);
  });
});

function renderOffline(path: string, status: SidecarStatus) {
  const nlp = {
    status: vi.fn(() => Promise.resolve(status)),
    restart: vi.fn(() => Promise.resolve()),
    retryPacks: vi.fn(() => Promise.resolve()),
  };
  const desktop: DesktopLocal = { nlp, connectServer: vi.fn(() => Promise.resolve()) };
  const file = {
    path: "/home/a/Documents/Kenning/kenning.sqlite",
    reveal: vi.fn(() => Promise.resolve()),
    move: vi.fn(() => Promise.resolve("/mnt/sync/kenning.sqlite")),
  };
  const services = createMockServices({ latencyMs: 0 });
  render(
    <App
      services={services}
      history={createMemoryHistory({ initialEntries: [path] })}
      desktop={desktop}
      data={{
        mode: "desktop",
        persisted: true,
        persistent: true,
        secure: true,
        admin: {
          info: () => Promise.resolve({ sizeBytes: 4096, eventCount: 3, deviceId: "d1" }),
          exportBackup: () => Promise.resolve(new Uint8Array()),
          importBackup: () => Promise.resolve(),
        },
        file,
      }}
    />,
  );
  return { nlp, desktop, file };
}

describe("offline app screens", () => {
  it("shows the calm download card while the library works", async () => {
    const { nlp } = renderOffline("/library", {
      ...downloading,
      health: {
        ...downloading.health,
        packs: {
          busy: false,
          items: { "mt-nl-en": { state: "missing", activity: "error: offline" } },
        },
      },
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Library" })).toBeVisible();
    expect(await screen.findByText(/Could not download the translation model/)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(nlp.retryPacks).toHaveBeenCalled();
  });

  it("shows download progress with the size", async () => {
    renderOffline("/library", downloading);
    expect(await screen.findByText(/Downloading the Dutch dictionary… 14 MB/)).toBeVisible();
    expect(screen.getByRole("progressbar", { name: "Download progress" })).toHaveAttribute(
      "aria-valuenow",
      "50",
    );
  });

  it("hides photo import without OCR and explains it", async () => {
    renderOffline("/import", downloading);
    expect(await screen.findByRole("tab", { name: "PDF" })).toBeVisible();
    await waitFor(() => expect(screen.queryByRole("tab", { name: "Photo" })).toBeNull());
    expect(screen.getByRole("note")).toHaveTextContent(/text recognition \(OCR\)/);
    expect(screen.getByRole("tab", { name: "Paste" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "URL" })).toBeVisible();
  });

  it("keeps photo import when the language server can read photos", async () => {
    renderOffline("/import", ready({ ocr: true }));
    expect(await screen.findByRole("tab", { name: "Photo" })).toBeVisible();
  });

  it("shows the data file in Settings with Show in folder and Move…", async () => {
    const { file, desktop } = renderOffline("/settings?section=data", ready({ ocr: false }));
    expect(await screen.findByTestId("data-file-path")).toHaveTextContent(
      "/home/a/Documents/Kenning/kenning.sqlite",
    );
    await userEvent.click(screen.getByRole("button", { name: "Show in folder" }));
    expect(file.reveal).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Move…" }));
    await waitFor(() =>
      expect(screen.getByTestId("data-file-path")).toHaveTextContent("/mnt/sync/kenning.sqlite"),
    );
    await userEvent.click(screen.getByRole("button", { name: "Connect to a Kenning server" }));
    expect(desktop.connectServer).toHaveBeenCalled();
  });
});
