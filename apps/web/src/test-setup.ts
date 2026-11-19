import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());

// The DOM shims apply to jsdom suites only (a few suites run in plain Node).
if (typeof window !== "undefined") {
  // jsdom lacks these browser APIs used by Radix and cmdk.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
  // jsdom has window.scrollTo but only logs "Not implemented" (route changes scroll to the top).
  window.scrollTo = (() => {}) as typeof window.scrollTo;
  // Saving a file clicks an <a download>; jsdom would try (and fail, noisily) to navigate.
  const anchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    if (!this.hasAttribute("download")) anchorClick.call(this);
  };
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  // Radix Select uses pointer capture, which jsdom lacks.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
}

// Routes are code-split: the first findBy in a file also pays for a cold screen import, which
// can exceed the 1 s default when several suites run in parallel.
configure({ asyncUtilTimeout: 5000 });
