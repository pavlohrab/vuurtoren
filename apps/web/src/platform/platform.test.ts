import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopBridge } from "../desktop/bridge.js";
import { currentDevice, isAndroidApp } from "./index.js";

const PIXEL =
  "Mozilla/5.0 (Linux; Android 16; sdk_gphone64_x86_64 Build/BP22.250325.006; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/133.0.0.0 Mobile Safari/537.36";
const LINUX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko)";

function withBridge(bridge: Partial<DesktopBridge> | undefined, tauri: boolean): void {
  Object.defineProperty(window, "__VUURTOREN_DESKTOP__", {
    value: bridge,
    configurable: true,
  });
  if (tauri)
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
}

afterEach(() => {
  Reflect.deleteProperty(window, "__VUURTOREN_DESKTOP__");
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  vi.unstubAllGlobals();
});

describe("isAndroidApp", () => {
  it("trusts the bridge's os", () => {
    expect(isAndroidApp({ os: "android" }, { tauri: true, userAgent: LINUX })).toBe(true);
  });

  it("falls back to the WebView's user agent inside Tauri", () => {
    expect(isAndroidApp({}, { tauri: true, userAgent: PIXEL })).toBe(true);
    expect(isAndroidApp({ os: "linux" }, { tauri: true, userAgent: LINUX })).toBe(false);
  });

  it("a phone's browser is not the app", () => {
    expect(isAndroidApp(null, { tauri: false, userAgent: PIXEL })).toBe(false);
  });
});

describe("currentDevice", () => {
  it("is android in the Android WebView", () => {
    withBridge({ home: true, os: "android" }, true);
    expect(currentDevice().kind).toBe("android");
    expect(currentDevice().syncPlaces).toEqual(["server", "webdav"]);
  });

  it("is android when an older bridge has no os but the user agent says Android", () => {
    vi.stubGlobal("navigator", { ...navigator, userAgent: PIXEL });
    withBridge({ home: true }, true);
    expect(currentDevice().kind).toBe("android");
  });

  it("is the desktop app on a computer, a browser without the bridge", () => {
    withBridge({ home: true, os: "linux" }, true);
    expect(currentDevice().kind).toBe("desktop");
    withBridge(undefined, false);
    expect(currentDevice().kind).toBe("browser");
  });
});
