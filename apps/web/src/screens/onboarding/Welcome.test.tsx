import { createMemoryHistory } from "@tanstack/react-router";
import { configure, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LanguageProfile } from "@app/core";
import { App } from "../../App.js";
import { createMockServices } from "../../services/mock.js";
import type { AppServices } from "../../services/types.js";

// The wizard is a lazy route: allow for a slow first import when the whole suite runs at once.
configure({ asyncUtilTimeout: 4000 });
afterEach(() => localStorage.clear());

function setup(patch: Partial<AppServices> = {}, path = "/library") {
  const base = createMockServices({ latencyMs: 0 });
  let saved: LanguageProfile | null = null;
  const saveLanguageProfile = vi.fn(async (p: LanguageProfile) => {
    saved = p;
  });
  const services: AppServices = {
    ...base,
    languageProfile: async () => saved,
    saveLanguageProfile,
    ...patch,
  };
  const history = createMemoryHistory({ initialEntries: [path] });
  render(<App services={services} history={history} />);
  return { services, history, saveLanguageProfile, user: userEvent.setup() };
}

const cont = () => screen.getByRole("button", { name: "Continue" });

describe("onboarding", () => {
  it("a new learner confirms suggested decks and chooses where new words go", async () => {
    const { user, history, saveLanguageProfile } = setup();
    expect(await screen.findByRole("heading", { name: "Welcome to Kenning" })).toBeVisible();
    expect(history.location.pathname).toBe("/welcome");
    expect(screen.queryByRole("radio", { name: /Українська/ })).toBeNull();
    expect(screen.getByText("More languages coming soon.")).toBeVisible();
    expect(screen.getByRole("radio", { name: /Nederlands/ })).toBeChecked();
    await user.click(cont());

    expect(await screen.findByRole("heading", { name: "Connect Anki" })).toBeVisible();
    expect(await screen.findByText(/Connected/)).toBeVisible();
    await user.click(cont());

    expect(await screen.findByRole("heading", { name: "Decks Kenning reads" })).toBeVisible();
    const core = await screen.findByRole("checkbox", { name: /Dutch::Core 2k/ });
    expect(core).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Opmaat::Thema 01/ })).not.toBeChecked();
    expect(screen.getByText("de fiets · gezellig · lopen")).toBeVisible();
    // Untick one suggestion
    await user.click(screen.getByRole("checkbox", { name: /A Frequency Dictionary/ }));
    await user.click(cont());

    expect(await screen.findByRole("heading", { name: "Where new words go" })).toBeVisible();
    expect(screen.getByLabelText("Default deck")).toHaveValue("Kenning::Nederlands");
    await user.click(screen.getByRole("radio", { name: "One deck per course" }));
    await user.click(screen.getByRole("button", { name: "Save and continue" }));

    // Decks were chosen: no placement check.
    expect(await screen.findByRole("heading", { name: "Your first text" })).toBeVisible();
    expect(saveLanguageProfile).toHaveBeenCalledTimes(1);
    const p = saveLanguageProfile.mock.calls[0]![0];
    expect(p.sources.map((s) => s.deck)).toEqual(["Dutch::Core 2k"]);
    expect(p.sources[0]).toMatchObject({
      modelName: "Basic (and reversed card)",
      wordField: "Front",
    });
    expect(p.destinations.reading).toBe("Kenning::Nederlands::Reading");
    expect(p.courseDecks).toBe("course");
    expect(p.tags).toEqual(["nl"]);

    await user.click(screen.getByRole("button", { name: "Import a text" }));
    await waitFor(() => expect(history.location.pathname).toBe("/import"));
  });

  it("without Anki: clear help, start fresh, placement recorded app-only", async () => {
    const savePlacement = vi.fn(async () => {});
    const suggestDecks = vi.fn(async () => []);
    const { user, saveLanguageProfile } = setup({
      ankiStatus: async () => ({ connected: false, state: "not-running" }),
      savePlacement,
      suggestDecks,
    });
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    expect(await screen.findByText(/Anki is not running/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Check again" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Continue without Anki" }));

    expect(await screen.findByText(/Kenning starts fresh/)).toBeVisible();
    expect(suggestDecks).not.toHaveBeenCalled();
    await user.click(cont());
    await user.click(await screen.findByRole("button", { name: "Save and continue" }));
    expect(saveLanguageProfile.mock.calls[0]![0].sources).toEqual([]);

    expect(await screen.findByRole("heading", { name: "Words you already know" })).toBeVisible();
    await user.click(await screen.findByRole("checkbox", { name: /het huis/ }));
    await user.click(screen.getByRole("checkbox", { name: /gezellig/ }));
    await user.click(screen.getByRole("button", { name: "Continue with 2 known" }));
    await waitFor(() => expect(savePlacement).toHaveBeenCalledWith(["huis", "gezellig"]));
    expect(await screen.findByRole("heading", { name: "Your first text" })).toBeVisible();
  });

  it("resumes at the saved step and can be skipped", async () => {
    localStorage.setItem("kenning.onboarding", JSON.stringify({ step: "anki" }));
    const { user, history } = setup();
    expect(await screen.findByRole("heading", { name: "Connect Anki" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Skip setup for now" }));
    await waitFor(() => expect(history.location.pathname).toBe("/library"));
    expect(localStorage.getItem("kenning.onboarding.skipped")).toBe("1");
  });

  it("is never shown in demo mode or once a profile exists", async () => {
    const base = createMockServices({ latencyMs: 0 });
    const history = createMemoryHistory({ initialEntries: ["/library"] });
    render(
      <App services={{ ...base, languageProfile: async () => null }} history={history} demo />,
    );
    expect(await screen.findByRole("navigation", { name: "Main" })).toBeVisible();
    expect(history.location.pathname).toBe("/library");
  });
});
