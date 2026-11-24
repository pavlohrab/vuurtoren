import { afterEach, describe, expect, it, vi } from "vitest";
import { externalHref, installExternalLinks } from "./externalLinks.js";

describe("external links on Android", () => {
  afterEach(() => {
    delete window.VuurtorenLinks;
    document.body.innerHTML = "";
  });

  it("finds new-tab links out, also from an icon inside them", () => {
    document.body.innerHTML =
      '<a id="a" href="https://vuurtoren.app/#why" target="_blank"><span id="s">Support</span></a>' +
      '<a id="b" href="/settings">Settings</a>';
    expect(externalHref(document.getElementById("s"))).toBe("https://vuurtoren.app/#why");
    expect(externalHref(document.getElementById("b"))).toBeNull();
  });

  it("hands a click to the phone's browser", () => {
    const open = vi.fn(() => true);
    window.VuurtorenLinks = { open };
    installExternalLinks();
    document.body.innerHTML = '<a id="a" href="https://vuurtoren.app/#why" target="_blank">x</a>';
    const e = new MouseEvent("click", { bubbles: true, cancelable: true });
    document.getElementById("a")!.dispatchEvent(e);
    expect(open).toHaveBeenCalledWith("https://vuurtoren.app/#why");
    expect(e.defaultPrevented).toBe(true);
  });
});
