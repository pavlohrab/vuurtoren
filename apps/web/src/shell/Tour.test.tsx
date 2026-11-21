import { createMemoryHistory } from "@tanstack/react-router";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App.js";
import { createMockServices } from "../services/mock.js";
import { startTour } from "./Tour.js";

// jsdom has no layout: every element gets a small box, so the tour finds its targets.
beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ x: 10, y: 10, width: 40, height: 20 }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

const renderApp = () =>
  render(
    <App
      services={createMockServices({ latencyMs: 0 })}
      history={createMemoryHistory({ initialEntries: ["/"] })}
    />,
  );

describe("the walkthrough", () => {
  it("is not shown unless asked; once started it steps through and ends for good", async () => {
    renderApp();
    expect(await screen.findByRole("heading", { level: 1, name: "Read" })).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "Read" })).toBeNull();
    act(() => startTour());
    const user = userEvent.setup();
    expect(await screen.findByRole("dialog", { name: "Read" })).toBeVisible();
    expect(screen.getByText("1 of 5")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Next" }));
    // The next step whose target is on screen (one that is not is passed over).
    expect(
      await screen.findByRole(
        "dialog",
        { name: /Tap a word|Help while reading|Your words/ },
        { timeout: 9000 },
      ),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Skip the tour" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(localStorage.getItem("vuurtoren.tour")).toBe("done");
  }, 20_000);

  it("takes taps outside the bubble: the page under it never sees them", async () => {
    renderApp();
    expect(await screen.findByRole("heading", { level: 1, name: "Read" })).toBeVisible();
    act(() => startTour());
    expect(await screen.findByRole("dialog", { name: "Read" })).toBeVisible();
    const seen = vi.fn();
    document.addEventListener("click", seen);
    document.addEventListener("pointerdown", seen);
    try {
      const scrims = screen.getAllByTestId("tour-scrim");
      // A step that asks for no tap: one scrim over the whole screen.
      expect(scrims).toHaveLength(1);
      const user = userEvent.setup();
      await user.click(scrims[0]!);
      expect(seen).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog", { name: "Read" })).toBeVisible();
      // The bubble's own buttons still work.
      await user.click(screen.getByRole("button", { name: "Next" }));
      expect(screen.queryByRole("dialog", { name: "Read" })).toBeNull();
    } finally {
      document.removeEventListener("click", seen);
      document.removeEventListener("pointerdown", seen);
    }
  });

  it("opens the current story for the reader steps when started elsewhere; focus follows the step", async () => {
    const history = createMemoryHistory({ initialEntries: ["/grammar"] });
    render(<App services={createMockServices({ latencyMs: 0 })} history={history} />);
    await screen.findByRole("heading", { level: 1, name: "Grammar" });
    act(() => startTour());
    const user = userEvent.setup();
    const first = await screen.findByRole("group", { name: "Read" });
    await waitFor(() => expect(first).toHaveFocus());
    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(history.location.pathname).toMatch(/^\/read\//), {
      timeout: 5000,
    });
    const tap = await screen.findByRole("group", { name: "Tap a word" }, { timeout: 5000 });
    await waitFor(() => expect(tap).toHaveFocus());
    expect(screen.getByText("2 of 5")).toBeVisible();
  }, 20_000);
});
