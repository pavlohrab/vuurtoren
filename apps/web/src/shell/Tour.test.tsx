import { createMemoryHistory } from "@tanstack/react-router";
import { act, render, screen, waitFor, within } from "@testing-library/react";
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
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => startTour());
    const user = userEvent.setup();
    // D4: it starts in the story (opened for it), then goes on to Read and Words.
    expect(
      await screen.findByRole("dialog", { name: "Tap a word" }, { timeout: 9000 }),
    ).toBeVisible();
    expect(screen.getByText("1 of 11")).toBeInTheDocument();
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Next" }));
    // The next step whose target is on screen (one that is not is passed over).
    expect(
      await screen.findByRole(
        "dialog",
        { name: /Its card|The sentence|Aa|Four ways|Cloze|Read|Words/ },
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
    // Past the first step (it takes a tap on the word): a step that takes none.
    const first = await screen.findByRole("dialog", { name: "Tap a word" }, { timeout: 9000 });
    await userEvent.setup().click(within(first).getByRole("button", { name: "Next" }));
    const plain = await screen.findByRole(
      "dialog",
      { name: /Its card|The sentence|Aa|Four ways|Cloze|Read/ },
      { timeout: 9000 },
    );
    const name = document.getElementById("tour-title")?.textContent ?? "";
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
      expect(plain).toBeVisible();
      // The bubble's own buttons still work.
      await user.click(within(plain).getByRole("button", { name: "Next" }));
      await waitFor(() => expect(screen.queryByRole("dialog", { name })).toBeNull());
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
    await waitFor(() => expect(history.location.pathname).toMatch(/^\/read\//), {
      timeout: 5000,
    });
    const tap = await screen.findByRole("group", { name: "Tap a word" }, { timeout: 5000 });
    await waitFor(() => expect(tap).toHaveFocus());
    expect(screen.getByText("1 of 11")).toBeInTheDocument();
  }, 20_000);

  it("goes through the reader to Read and Words and ends on Practice; Read is the mode again (OB9)", async () => {
    const history = createMemoryHistory({ initialEntries: ["/"] });
    render(<App services={createMockServices({ latencyMs: 0, native: true })} history={history} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Read" })).toBeVisible();
    act(() => startTour());
    const user = userEvent.setup();
    await screen.findByRole("dialog", {}, { timeout: 9000 });
    // Next until the last step (the reader steps open the current story on the way).
    for (let i = 0; i < 11 && !screen.queryByRole("dialog", { name: "Words" }); i++) {
      const step = await screen.findByRole("dialog", {}, { timeout: 9000 });
      await user.click(within(step).getByRole("button", { name: "Next" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeNull(), { timeout: 9000 });
    }
    const words = await screen.findByRole("dialog", { name: "Words" }, { timeout: 9000 });
    expect(history.location.pathname).toBe("/words");
    expect(words).toHaveTextContent(/your level and your words/);
    await user.click(within(words).getByRole("button", { name: "Next" }));
    await screen.findByRole("dialog", { name: "Practice" }, { timeout: 9000 });
    expect(history.location.pathname).toBe("/practice");
    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  }, 60_000);
});
