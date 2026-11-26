import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App.js";
import { createMockServices } from "../../services/mock.js";

// A computer window with room for the Inbox (mock "Words, round 2" A).
beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((q: string) => ({
      matches: q.includes("min-width"),
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })),
  );
});
afterEach(() => vi.unstubAllGlobals());

function setup(url: string) {
  const services = createMockServices({ latencyMs: 0 });
  const markKnown = vi.spyOn(services, "markKnown");
  const history = createMemoryHistory({ initialEntries: [url] });
  render(<App services={services} history={history} />);
  return { services, markKnown, history, user: userEvent.setup() };
}

describe("Words on a computer: the Inbox", () => {
  it("has folders on the left, the folder's words in the middle and the chosen word on the right", async () => {
    const { user, history } = setup("/words/all?layout=list&state=decide");
    const rail = await screen.findByRole("navigation", { name: "Your words" });
    expect(within(rail).getByRole("button", { name: /To decide/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(await screen.findByRole("heading", { level: 1, name: "To decide" })).toBeVisible();
    const pane = screen.getByRole("complementary", { name: "The chosen word" });
    expect(await within(pane).findByRole("button", { name: /Add to my words/ })).toBeVisible();
    // Another folder: Known.
    await user.click(within(rail).getByRole("button", { name: /^Known/ }));
    await waitFor(() => expect(String(history.location.search)).toContain("state=known"));
    expect(await screen.findByRole("heading", { level: 1, name: "Known" })).toBeVisible();
  });

  it("All stays in the Inbox when it came from a link with only a state", async () => {
    const { user, history } = setup("/words/all?state=learning");
    const rail = await screen.findByRole("navigation", { name: "Your words" });
    await user.click(within(rail).getByRole("button", { name: /^All/ }));
    await waitFor(() => expect(String(history.location.search)).not.toContain("state="));
    expect(screen.getByRole("navigation", { name: "Your words" })).toBeVisible();
    expect(await screen.findByRole("heading", { level: 1, name: "All words" })).toBeVisible();
  });

  it("I know it marks a new word known, and the next one opens", async () => {
    const { user, markKnown, history, services } = setup("/words/all?layout=list&state=decide");
    const pane = await screen.findByRole("complementary", { name: "The chosen word" });
    const list = await screen.findByRole("list", { name: "To decide" });
    const [first, second] = within(list).getAllByRole("button", { name: /^Open / });
    const firstKey = first!.getAttribute("aria-label")!.replace("Open ", "");
    await user.click(await within(pane).findByRole("button", { name: /^I know it/ }));
    await waitFor(() =>
      expect(markKnown).toHaveBeenCalledWith(expect.objectContaining({ key: firstKey }), undefined),
    );
    // No Leave: nothing in the app ignores a word.
    expect(within(pane).queryByRole("button", { name: /^Leave/ })).toBeNull();
    const secondKey = second!.getAttribute("aria-label")!.replace("Open ", "");
    await waitFor(() => expect(String(history.location.search)).toContain(`word=${secondKey}`));
    // The list moved on, so Undo is on the toast: the word is taken back.
    const reset = vi.spyOn(services, "resetWordState");
    const undoKnown = services.undoKnown ? vi.spyOn(services, "undoKnown") : null;
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(reset.mock.calls.length + (undoKnown?.mock.calls.length ?? 0)).toBe(1),
    );
    expect(await screen.findByText("Not marked as known any more")).toBeInTheDocument();
  });

  it("a ticked word gets the dark bar: Add, I know them, Clear", async () => {
    const { user } = setup("/words/all?layout=list");
    const list = await screen.findByRole("list", { name: "All words" });
    const boxes = await within(list).findAllByRole("checkbox");
    await user.click(boxes[0]!);
    const bar = screen.getByRole("region", { name: "Selected words" });
    expect(bar).toHaveTextContent("1 selected");
    for (const name of [/Add to/, "I know them", "Clear"])
      expect(within(bar).getByRole("button", { name })).toBeVisible();
    await user.click(within(bar).getByRole("button", { name: "Clear" }));
    expect(screen.queryByRole("region", { name: "Selected words" })).toBeNull();
  });
});
