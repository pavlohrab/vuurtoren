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
});
