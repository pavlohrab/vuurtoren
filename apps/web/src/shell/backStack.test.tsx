import { createMemoryHistory } from "@tanstack/react-router";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App.js";
import { createMockServices } from "../services/mock.js";
import { rememberReader, takeReaderReturn } from "../screens/reader/readerReturn.js";
import { closeTopmost, levelUp, pushBack, systemBack, tabRoot } from "./backStack.js";

afterEach(() => {
  Reflect.deleteProperty(window, "__VUURTOREN_DESKTOP__");
});

describe("Back, overlay first", () => {
  it("closes the last opened overlay first, then goes to the tab's start, then leaves", () => {
    const closed: string[] = [];
    const nav = { toTab: vi.fn(), exit: vi.fn() };
    const offSheet = pushBack(() => closed.push("sheet"));
    const offTour = pushBack(() => closed.push("tour"));
    expect(systemBack("/read/t1", nav)).toBe("overlay");
    offTour();
    expect(systemBack("/read/t1", nav)).toBe("overlay");
    offSheet();
    expect(closed).toEqual(["tour", "sheet"]);
    expect(nav.toTab).not.toHaveBeenCalled();
    expect(systemBack("/read/t1", nav)).toBe("tab");
    expect(nav.toTab).toHaveBeenLastCalledWith("/");
    expect(systemBack("/", nav)).toBe("exit");
    expect(nav.exit).toHaveBeenCalledOnce();
  });

  it("knows which tab a page belongs to; More's pages count as Read", () => {
    expect(tabRoot("/grammar/word-order")).toBe("/");
    expect(tabRoot("/settings")).toBe("/");
    expect(tabRoot("/read/t1/words")).toBe("/");
    expect(tabRoot("/review")).toBe("/words");
    expect(tabRoot("/practice")).toBe("/words");
    expect(tabRoot("/words")).toBe("/words");
    const nav = { toTab: vi.fn(), exit: vi.fn() };
    expect(systemBack("/review", nav)).toBe("tab");
    expect(nav.toTab).toHaveBeenLastCalledWith("/words");
    expect(systemBack("/words", nav)).toBe("exit");
  });

  it("closes an open dialog (Radix layer) with Escape before the app's own overlays", () => {
    const sheet = vi.fn();
    const off = pushBack(sheet);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.dataset.state = "open";
    const escaped = vi.fn();
    document.body.append(dialog);
    document.addEventListener("keydown", (e) => e.key === "Escape" && escaped(), { once: true });
    try {
      expect(closeTopmost()).toBe(true);
      expect(escaped).toHaveBeenCalledOnce();
      expect(sheet).not.toHaveBeenCalled();
    } finally {
      dialog.remove();
      off();
    }
    expect(closeTopmost()).toBe(false);
  });

  it("listens to Android Back through the app bridge while mounted", async () => {
    let fire: ((e: { canGoBack: boolean }) => void) | null = null;
    const unlisten = vi.fn();
    const exit = vi.fn(() => Promise.resolve());
    Object.defineProperty(window, "__VUURTOREN_DESKTOP__", {
      configurable: true,
      value: {
        back: {
          listen: (fn: typeof fire) => {
            fire = fn;
            return unlisten;
          },
          exit,
        },
      },
    });
    const history = createMemoryHistory({ initialEntries: ["/grammar"] });
    const { unmount } = render(
      <App services={createMockServices({ latencyMs: 0 })} history={history} />,
    );
    await waitFor(() => expect(fire).not.toBeNull());
    act(() => fire!({ canGoBack: true }));
    await waitFor(() => expect(history.location.pathname).toBe("/"));
    expect(exit).not.toHaveBeenCalled();
    act(() => fire!({ canGoBack: true }));
    expect(exit).toHaveBeenCalledOnce();
    unmount();
    expect(unlisten).toHaveBeenCalled();
  });
});

describe("the More sheet", () => {
  it("closes on Back, on choosing an item, and does not come back after going back", async () => {
    const history = createMemoryHistory({ initialEntries: ["/"] });
    render(<App services={createMockServices({ latencyMs: 0 })} history={history} />);
    const user = userEvent.setup();
    const more = await screen.findByRole("button", { name: "More" });
    await user.click(more);
    expect(screen.getByRole("menu", { name: "More" })).toBeVisible();
    // System Back closes the sheet (and nothing else), focus returns to its button.
    act(() => void systemBack("/", { toTab: () => {}, exit: () => {} }));
    expect(screen.queryByRole("menu", { name: "More" })).toBeNull();
    expect(more).toHaveFocus();
    expect(history.location.pathname).toBe("/");
    // Choose Grammar, then go back: the sheet stays closed.
    await user.click(more);
    await user.click(screen.getByRole("menuitem", { name: "Grammar" }));
    await waitFor(() => expect(history.location.pathname).toBe("/grammar"));
    expect(screen.queryByRole("menu", { name: "More" })).toBeNull();
    act(() => history.back());
    await waitFor(() => expect(history.location.pathname).toBe("/"));
    expect(screen.queryByRole("menu", { name: "More" })).toBeNull();
  });

  it("goes one level up before the tab's start: a Settings section to the list", () => {
    const up = vi.fn();
    const nav = { toTab: vi.fn(), exit: vi.fn(), up };
    expect(systemBack({ pathname: "/settings", search: { section: "devices" } }, nav)).toBe("up");
    expect(up).toHaveBeenCalledWith({ to: "/settings" });
    expect(systemBack({ pathname: "/settings", search: {} }, nav)).toBe("tab");
    expect(nav.toTab).toHaveBeenCalledWith("/");
  });

  it("knows the level above each page", () => {
    expect(levelUp("/grammar/word-order")).toEqual({ to: "/grammar" });
    expect(levelUp("/grammar/word-order/practice")).toEqual({ to: "/grammar/word-order" });
    expect(levelUp("/exam/reading")).toEqual({ to: "/exam" });
    expect(levelUp("/courses/c1/u2")).toEqual({ to: "/courses/c1" });
    expect(levelUp("/courses/c1")).toEqual({ to: "/courses" });
    expect(levelUp("/courses/import")).toEqual({ to: "/courses" });
    expect(levelUp("/read/t1/words")).toEqual({ to: "/read/t1" });
    expect(levelUp("/read/t1")).toBeNull();
    expect(levelUp("/settings")).toBeNull();
    expect(levelUp("/words/all")).toBeNull();
  });
});

describe("Back from a grammar topic the reader opened (RD5)", () => {
  afterEach(() => sessionStorage.clear());
  const saved = {
    textId: "t1",
    segment: 2,
    selected: 14,
    focusTopic: null,
    topic: "separable-verbs",
  };

  it("goes back to the text, not to Grammar", () => {
    rememberReader(saved);
    expect(levelUp("/grammar/separable-verbs")).toEqual({ to: "/read/t1" });
  });

  it("only for the topic the reader opened", () => {
    rememberReader(saved);
    expect(levelUp("/grammar/inversion")).toEqual({ to: "/grammar" });
  });

  it("the reader takes its place once, for its own text", () => {
    rememberReader(saved);
    expect(takeReaderReturn("t2")).toBeNull();
    expect(takeReaderReturn("t1")).toEqual(saved);
    expect(takeReaderReturn("t1")).toBeNull();
  });
});
