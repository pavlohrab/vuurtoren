import { afterEach, describe, expect, it, vi } from "vitest";
import { AnkiConnectClient, probeAnki } from "@app/anki";
import { browserPlatform } from "../services/platform.js";
import { type DesktopBridge, desktopBridge, isLocalAnki, withDesktopAnki } from "./bridge.js";

function fakeBridge(over: Partial<DesktopBridge> = {}): DesktopBridge {
  return {
    home: true,
    info: vi.fn(() => Promise.resolve({ version: "0.1.0" })),
    ankiFetch: vi.fn(() => Promise.resolve({ status: 200, body: '{"result":6,"error":null}' })),
    db: {
      open: vi.fn(() =>
        Promise.resolve({
          path: "/k/vuurtoren.sqlite",
          created: true,
          conflicts: [],
          locked: null,
        }),
      ),
      exec: vi.fn(() => Promise.resolve([])),
      close: vi.fn(() => Promise.resolve()),
      exportFile: vi.fn(() => Promise.resolve(new Uint8Array())),
      importFile: vi.fn(() => Promise.resolve()),
      reveal: vi.fn(() => Promise.resolve()),
      move: vi.fn(() => Promise.resolve(null)),
    },
    nlp: {
      status: vi.fn(() => Promise.resolve({ state: "ready" as const, health: null })),
      restart: vi.fn(() => Promise.resolve()),
      retryPacks: vi.fn(() => Promise.resolve()),
    },
    ...over,
  };
}

afterEach(() => {
  delete window.__VUURTOREN_DESKTOP__;
  vi.restoreAllMocks();
});

describe("desktop bridge detection", () => {
  it("is absent in a normal browser", () => {
    expect(desktopBridge()).toBeNull();
  });

  it("is found when the desktop app injected it", () => {
    const bridge = fakeBridge();
    window.__VUURTOREN_DESKTOP__ = bridge;
    expect(desktopBridge()).toBe(bridge);
  });

  it("only forwards AnkiConnect on this machine", () => {
    expect(isLocalAnki("http://127.0.0.1:8765")).toBe(true);
    expect(isLocalAnki("http://localhost:8765/")).toBe(true);
    expect(isLocalAnki("/anki")).toBe(false);
    expect(isLocalAnki("http://127.0.0.1:8000/nlp")).toBe(false);
    expect(isLocalAnki("https://127.0.0.1:8765")).toBe(false);
    expect(isLocalAnki("http://anki.example:8765")).toBe(false);
  });
});

describe("Anki through the desktop bridge", () => {
  it("sends AnkiConnect requests through the app and everything else to fetch", async () => {
    const bridge = fakeBridge();
    const fallback = vi.fn(() => Promise.resolve(new Response("nlp")));
    const f = withDesktopAnki(bridge, fallback);

    const res = await f("http://127.0.0.1:8765", { method: "POST", body: '{"action":"version"}' });
    expect(await res.json()).toEqual({ result: 6, error: null });
    expect(bridge.ankiFetch).toHaveBeenCalledWith({
      url: "http://127.0.0.1:8765",
      method: "POST",
      body: '{"action":"version"}',
    });
    expect(fallback).not.toHaveBeenCalled();

    await f("/nlp/analyze", { method: "POST" });
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("works with the real Anki client and probe", async () => {
    const bridge = fakeBridge({
      ankiFetch: vi.fn(({ body }: { body?: string | undefined }) => {
        const action = body ? (JSON.parse(body) as { action: string }).action : "";
        const result = action === "version" ? 6 : action === "deckNames" ? ["Dutch"] : null;
        return Promise.resolve({ status: 200, body: JSON.stringify({ result, error: null }) });
      }),
    });
    const fetch = withDesktopAnki(bridge, () => Promise.reject(new Error("not used")));
    expect(await new AnkiConnectClient({ fetch }).deckNames()).toEqual(["Dutch"]);
    expect(await probeAnki({ fetch })).toEqual({ state: "connected", version: 6 });
  });

  it("reports a bridge failure like a failed browser fetch (Anki not running)", async () => {
    const bridge = fakeBridge({
      ankiFetch: vi.fn(() => Promise.reject("cannot reach AnkiConnect: connection refused")),
    });
    const fetch = withDesktopAnki(bridge, () => Promise.reject(new TypeError("closed")));
    await expect(fetch("http://127.0.0.1:8765", { method: "POST" })).rejects.toBeInstanceOf(
      TypeError,
    );
    expect(await probeAnki({ fetch })).toEqual({ state: "not-running" });
  });

  it("gives up when the caller's signal aborts", async () => {
    const bridge = fakeBridge({ ankiFetch: vi.fn(() => new Promise<never>(() => {})) });
    const fetch = withDesktopAnki(bridge, globalThis.fetch);
    const ctl = new AbortController();
    const pending = fetch("http://127.0.0.1:8765", { method: "POST", signal: ctl.signal });
    ctl.abort(new DOMException("slow", "TimeoutError"));
    await expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("is used by the platform fetch when the app runs in the desktop window", async () => {
    const bridge = fakeBridge();
    window.__VUURTOREN_DESKTOP__ = bridge;
    const res = await browserPlatform().fetch("http://127.0.0.1:8765", { method: "POST" });
    expect(res.status).toBe(200);
    expect(bridge.ankiFetch).toHaveBeenCalledTimes(1);
  });
});
