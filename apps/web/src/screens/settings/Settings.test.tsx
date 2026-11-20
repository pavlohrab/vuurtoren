import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App.js";
import { createMockServices } from "../../services/mock.js";
import type { AppServices, Settings } from "../../services/types.js";

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
      "Reading & audio",
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
    const box = await screen.findByRole("checkbox", { name: /Grammar marks/ });
    const before = (box as HTMLInputElement).checked;
    await user.click(box);
    await waitFor(() => expect(saves.at(-1)?.grammarMarks).toBe(!before), {
      timeout: 2000,
    });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("saves the voice, the speed and the autoplay choices", async () => {
    const { saves, user } = setup("/settings?section=reading");
    await user.click(await screen.findByRole("combobox", { name: "Voice" }));
    await user.click(await screen.findByRole("option", { name: "Male" }));
    await user.click(screen.getByRole("combobox", { name: "Speed" }));
    await user.click(await screen.findByRole("option", { name: "0.8×" }));
    const word = screen.getByRole("checkbox", { name: /Say the word/ });
    const sentence = screen.getByRole("checkbox", { name: /Say the sentence/ });
    expect(word).toBeChecked();
    expect(sentence).not.toBeChecked();
    await user.click(word);
    await user.click(sentence);
    await waitFor(
      () =>
        expect(saves.at(-1)).toMatchObject({
          voice: "male",
          audioRate: 0.8,
          autoplayWord: false,
          autoplaySentence: true,
        }),
      { timeout: 2000 },
    );
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

  describe("server status", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("shows the version and what the language server is missing", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) =>
          String(url).endsWith("/health")
            ? new Response(
                JSON.stringify({
                  status: "ok",
                  version: "9.9.9",
                  data: { dictionary: true, sentences: false, translation: true },
                }),
              )
            : new Response("", { status: 404 }),
        ),
      );
      setup("/settings?section=advanced");
      const status = await screen.findByRole("region", { name: "Server status" });
      expect(within(status).getByText("Vuurtoren")).toBeInTheDocument();
      expect(within(status).getByText(/^\d+\.\d+\.\d+/)).toBeInTheDocument();
      expect(
        await within(status).findByText("9.9.9, missing: example sentences", {}, { timeout: 3000 }),
      ).toBeInTheDocument();
      expect(within(status).getByText("Anki")).toBeInTheDocument();
      expect(within(status).getByRole("button", { name: "Copy" })).toBeInTheDocument();
    });
  });
});
