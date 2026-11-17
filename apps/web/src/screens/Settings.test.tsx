import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "../App.js";
import { createMockServices } from "../services/mock.js";
import type { AppServices, Settings } from "../services/types.js";

function setup(url: string) {
  const base = createMockServices({ latencyMs: 0 });
  const saves: Partial<Settings>[] = [];
  const services: AppServices = {
    ...base,
    saveSettings: async (patch) => {
      saves.push(patch);
      return base.saveSettings(patch);
    },
  };
  render(<App services={services} history={createMemoryHistory({ initialEntries: [url] })} />);
  return { saves, user: userEvent.setup() };
}

describe("Settings", () => {
  it("has sections in a sub-nav, with Anki's connection at the top of Language & decks", async () => {
    setup("/settings");
    const nav = await screen.findByRole("navigation", { name: "Settings sections" });
    for (const name of [
      "Account",
      "Language & decks",
      "Reading",
      "AI",
      "Data & backup",
      "Advanced",
    ])
      expect(within(nav).getByRole("link", { name: new RegExp(name) })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Language & decks" })).toBeVisible();
    const anki = screen.getByRole("group", { name: "Anki connection" });
    expect(await within(anki).findByText(/Anki is (connected|not connected)/)).toBeInTheDocument();
    // No theme picker here: the theme lives in the top bar only.
    expect(screen.queryByLabelText("Theme")).toBeNull();
    expect(screen.queryByRole("button", { name: /Save settings/ })).toBeNull();
  });

  it("saves reading settings on their own and says so quietly", async () => {
    const { saves, user } = setup("/settings?section=reading");
    const box = await screen.findByRole("checkbox", { name: /Grammar spotlights/ });
    const before = (box as HTMLInputElement).checked;
    await user.click(box);
    await waitFor(() => expect(saves.at(-1)?.grammarSpotlights).toBe(!before), {
      timeout: 2000,
    });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("keeps the addresses under Advanced", async () => {
    const { saves, user } = setup("/settings?section=advanced");
    const field = await screen.findByLabelText("Language server address");
    await user.clear(field);
    await user.type(field, "http://nlp.local");
    await waitFor(() => expect(saves.at(-1)?.nlpUrl).toBe("http://nlp.local"), {
      timeout: 2000,
    });
    expect(screen.getByLabelText("AnkiConnect address")).toBeInTheDocument();
  });
});
