import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../../App.js";
import { createMockServices } from "../../services/mock.js";

function setup(native: boolean) {
  const services = createMockServices({ latencyMs: 0, synced: true, native });
  const history = createMemoryHistory({ initialEntries: ["/settings?section=language"] });
  render(<App services={services} history={history} />);
  return { services, user: userEvent.setup() };
}

describe("Settings → Language & decks: cards", { timeout: 20_000 }, () => {
  it("moves a connected learner from Anki to Kenning", async () => {
    const { services, user } = setup(false);
    await user.click(await screen.findByRole("button", { name: "Move from Anki to Kenning" }));
    expect(screen.getByText(/Keep Anki open while it runs/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Move to Kenning" }));
    expect(await screen.findByText(/Your reviews now happen in Kenning/)).toBeVisible();
    expect((await services.languageProfile())?.mode).toBe("native");
    // The native settings replace the Anki deck detection.
    expect(await screen.findByRole("heading", { name: "Your cards" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Decks Kenning reads" })).toBeNull();
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(await within(nav).findByRole("link", { name: /Review/ })).toBeVisible();
  });

  it("imports chosen decks of a file, sets target recall and optimises", async () => {
    const { user } = setup(true);
    expect(await screen.findByRole("heading", { name: "Your cards" })).toBeVisible();
    expect(
      await screen.findByRole("combobox", { name: "Target recall for Kenning::Nederlands" }),
    ).toHaveValue("0.9");
    const file = new File([new Uint8Array([1])], "deck.apkg");
    await user.upload(screen.getByLabelText("Choose a file"), file);
    const second = await screen.findByRole("checkbox", { name: /De Opmaat::Thema 02/ });
    await user.click(second);
    await user.click(screen.getByRole("button", { name: "Import 1 deck" }));
    expect(await screen.findByText(/Imported 50 cards from 50 notes/)).toBeVisible();

    expect(screen.getByText(/Using the FSRS defaults/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Optimise now" }));
    expect(await screen.findByText(/Tuned on 31,?877 reviews/)).toBeVisible();
    const table = screen.getByRole("table", { name: "Fit before and after tuning" });
    expect(within(table).getByText("0.3378")).toBeVisible();
    expect(within(table).getByText("0.3121")).toBeVisible();
  });

  it("exports the decks to an .apkg file", async () => {
    const created = vi.fn(() => "blob:apkg");
    vi.stubGlobal(
      "URL",
      Object.assign(URL, { createObjectURL: created, revokeObjectURL: () => {} }),
    );
    const { user } = setup(true);
    await user.click(await screen.findByRole("button", { name: "Export to .apkg" }));
    expect(
      await screen.findByText(
        /^Exported \d+ notes?, \d+ cards? and \d+ reviews? to Kenning\.apkg\.$/,
      ),
    ).toBeVisible();
    expect(created).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
