import { afterEach, describe, expect, it } from "vitest";
import { applyInsets, installNativeInsets } from "./insets.js";

describe("native insets", () => {
  afterEach(() => {
    delete window.VuurtorenInsets;
    delete window.__vuurtorenInsets;
    document.documentElement.removeAttribute("style");
  });

  it("sets the app's insets as CSS variables, at start and on change", () => {
    window.VuurtorenInsets = { get: () => '{"top":24,"right":0,"bottom":16,"left":0}' };
    installNativeInsets();
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--native-safe-top")).toBe("24px");
    expect(style.getPropertyValue("--native-safe-bottom")).toBe("16px");
    window.__vuurtorenInsets?.({ top: 0, right: 48, bottom: 16, left: 0 });
    expect(style.getPropertyValue("--native-safe-top")).toBe("0px");
    expect(style.getPropertyValue("--native-safe-right")).toBe("48px");
  });

  it("does nothing without the app, and ignores bad values", () => {
    installNativeInsets();
    expect(window.__vuurtorenInsets).toBeUndefined();
    applyInsets({ top: Number.NaN, bottom: -3 });
    expect(document.documentElement.style.getPropertyValue("--native-safe-top")).toBe("");
  });
});
