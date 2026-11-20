import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../../App.js";
import { createMockServices } from "../../services/mock.js";
import { readPrefs } from "./readerPrefs.js";

const SLOW = { timeout: 4000 };

async function openSideBySide() {
  const history = createMemoryHistory({ initialEntries: ["/read/t-regen"] });
  render(<App services={createMockServices({ latencyMs: 0 })} history={history} />);
  await userEvent.click(await screen.findByRole("tab", { name: "Side by side" }, SLOW));
  // The first page holds the first paragraph: two sentences, one row each.
  await waitFor(() => expect(document.querySelectorAll(".k-sbs-row")).toHaveLength(2));
  return Array.from(document.querySelectorAll<HTMLElement>(".k-sbs-row"));
}

const word = (side: "nl" | "en", text: string, row?: HTMLElement) =>
  Array.from((row ?? document).querySelectorAll<HTMLElement>(`[data-side="${side}"]`)).find(
    (el) => el.textContent === text,
  )!;

beforeEach(() => localStorage.clear());

describe("side by side", () => {
  it("shows the English of hard sentences and lights up partners both ways", async () => {
    const [first, second] = await openSideBySide();
    // "Omdat … binnen" has two words to learn: below 85% known, so its English shows.
    expect(await within(second!).findByText("rained")).toBeInTheDocument();
    expect(within(first!).getByRole("button", { name: "Show English" })).toBeInTheDocument();

    await userEvent.click(within(first!).getByRole("button", { name: "Show English" }));
    await userEvent.hover(word("nl", "bel", first));
    expect(word("en", "call", first)).toHaveAttribute("data-active");
    expect(word("nl", "op", first)).toHaveAttribute("data-active");

    await userEvent.hover(word("en", "stayed", second));
    expect(word("nl", "bleven", second)).toHaveAttribute("data-active");
  });

  it("a Dutch word opens the word inspector", async () => {
    const [, second] = await openSideBySide();
    await userEvent.click(word("nl", "binnen", second));
    expect(word("nl", "binnen", second)).toHaveAttribute("data-selected", "true");
    const panel = await screen.findByLabelText("Word details", {}, SLOW);
    expect(within(panel).getByRole("heading", { name: "binnen" })).toBeInTheDocument();
  });

  it("the structure view adds the word-order note from the grammar detectors", async () => {
    const [, second] = await openSideBySide();
    await userEvent.click(within(second!).getByRole("button", { name: "Structure" }));
    expect(second).toHaveAttribute("data-structure");
    expect(
      await within(second!).findByText(/the finite verb «regende» moves to the end/),
    ).toBeInTheDocument();
    expect(within(second!).getByText("Verb at the end.")).toBeInTheDocument();
    expect(word("nl", "regende", second)).toHaveAttribute("data-pc");
  });

  it("the English setting is kept with the reading preferences", async () => {
    const [first] = await openSideBySide();
    await userEvent.click(screen.getByRole("button", { name: "Reading settings" }));
    const group = await screen.findByRole("radiogroup", { name: "English" });
    await userEvent.click(within(group).getByRole("radio", { name: "Always" }));
    expect(readPrefs().english).toBe("always");
    expect(await within(first!).findByText("call")).toBeInTheDocument();
    await userEvent.click(within(group).getByRole("radio", { name: "Tap to show" }));
    expect(readPrefs().english).toBe("tap");
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Show English" })).toHaveLength(2),
    );
  });
});
