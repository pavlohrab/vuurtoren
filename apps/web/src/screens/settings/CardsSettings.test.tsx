import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
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

describe("Settings → Your words: cards", { timeout: 20_000 }, () => {
  it("moves a connected learner from Anki to Vuurtoren", async () => {
    const { services, user } = setup(false);
    await user.click(await screen.findByRole("button", { name: "Move from Anki to Vuurtoren" }));
    expect(screen.getByText(/Keep Anki open while it runs/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Move to Vuurtoren" }));
    expect(await screen.findByText(/Your reviews now happen in Vuurtoren/)).toBeVisible();
    expect((await services.languageProfile())?.mode).toBe("native");
    // The native settings replace the Anki deck detection.
    expect(await screen.findByRole("heading", { name: "Your cards" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Decks Vuurtoren reads" })).toBeNull();
    const nav = screen.getByRole("navigation", { name: "Main" });
    // Words opens on its home, with Due today from Vuurtoren's own cards.
    await waitFor(() =>
      expect(within(nav).getByRole("link", { name: /^Words/ })).toHaveAttribute("href", "/words"),
    );
  });

  it("adds the most common words, and sets the level new words start from", async () => {
    const { services, user } = setup(true);
    expect(await screen.findByRole("heading", { name: "Starter words" })).toBeVisible();
    expect(screen.queryByText(/extended/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Add the most common words" }));
    await waitFor(async () =>
      expect((await services.starterLevels()).held).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
    );
    await user.click(await screen.findByRole("combobox", { name: "Start new words from level" }));
    await user.click(await screen.findByRole("option", { name: /^A2 \(words 1001/ }));
    await waitFor(async () => expect((await services.starterLevels()).from).toBe(3));
    const section = screen.getByRole("region", { name: "Starter words" });
    expect(within(section).queryByText(/Anki/)).toBeNull();
  });

  it("imports chosen decks of a file, sets target recall and optimises", async () => {
    const { user } = setup(true);
    expect(await screen.findByRole("heading", { name: "Your cards" })).toBeVisible();
    expect(
      await screen.findByRole("combobox", { name: "Target recall for Vuurtoren::Nederlands" }),
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
        /^Exported \d+ notes?, \d+ cards? and \d+ reviews? to Vuurtoren\.apkg\.$/,
      ),
    ).toBeVisible();
    expect(created).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("moves a native learner to Anki, with the history as an option", async () => {
    const { user, services } = setup(true);
    await user.click(await screen.findByRole("button", { name: "Move to Anki…" }));
    await user.click(screen.getByRole("checkbox", { name: /review history/ }));
    await user.click(screen.getByRole("button", { name: "Move to Anki" }));
    expect(await screen.findByText("Your reviews now happen in Anki")).toBeVisible();
    expect((await services.languageProfile())?.mode).toBe("connected");
  });

  it("shows the load of each target recall and saves lighter review days", async () => {
    const { user, services } = setup(true);
    const recall = await screen.findAllByRole("combobox", { name: /^Target recall for/ });
    expect(
      within(recall[0]!).getByRole("option", { name: /^90% · about \d+ a day$/ }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "Saturday" }));
    await user.click(await screen.findByRole("option", { name: "Minimum" }));
    await waitFor(async () =>
      expect((await services.getSettings()).reviewWeek).toEqual([1, 1, 1, 1, 1, 0, 1]),
    );
  });

  it("keeps every review day changed quickly, before the first one is saved", async () => {
    const { user, services } = setup(true);
    const save = services.saveSettings.bind(services);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.spyOn(services, "saveSettings").mockImplementation(async (patch) => {
      await gate;
      return save(patch);
    });
    await user.click(await screen.findByRole("combobox", { name: "Saturday" }));
    await user.click(await screen.findByRole("option", { name: "Minimum" }));
    await user.click(screen.getByRole("combobox", { name: "Sunday" }));
    await user.click(await screen.findByRole("option", { name: "Reduced" }));
    release();
    await waitFor(async () =>
      expect((await services.getSettings()).reviewWeek).toEqual([1, 1, 1, 1, 1, 0, 0.5]),
    );
  });
});
