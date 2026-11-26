import { createMemoryHistory } from "@tanstack/react-router";
import { act, configure, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LanguageProfile } from "@app/core";
import { App } from "../../App.js";
import { currentDevice } from "../../platform/index.js";
import { createMockServices } from "../../services/mock.js";
import type { AppServices } from "../../services/types.js";

vi.mock("../../platform/index.js", async (load) => {
  const real = await load<typeof import("../../platform/index.js")>();
  return { ...real, currentDevice: vi.fn(real.currentDevice) };
});

// The wizard is a lazy route: allow for a slow first import when the whole suite runs at once.
configure({ asyncUtilTimeout: 4000 });
afterEach(() => localStorage.clear());

function setup(patch: Partial<AppServices> = {}, path = "/") {
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
    // One question first, nothing to explain (m5).
    expect(await screen.findByRole("heading", { name: "Do you use Anki?" })).toBeVisible();
    expect(history.location.pathname).toBe("/welcome");
    expect(screen.queryByRole("radio", { name: /Nederlands/ })).toBeNull();
    // Three fixed parts, whatever the answers add.
    const parts = () =>
      within(screen.getByRole("list", { name: "Setup steps" }))
        .getAllByRole("listitem")
        .map((li) => li.textContent);
    expect(parts()).toEqual(["1. Getting started", "2. Your words", "3. Start reading"]);
    // The answer is the button: no Continue (mock MK4 A).
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Yes" }));
    expect(await screen.findByRole("heading", { name: "Your Anki cards" })).toBeVisible();
    expect(parts()).toHaveLength(3);
    await user.click(screen.getByRole("radio", { name: /Keep using Anki/ }));
    expect(screen.getByText(/Anki must be open for Vuurtoren to send words to it/)).toBeVisible();
    await user.click(cont());

    expect(await screen.findByRole("heading", { name: "Connect Anki" })).toBeVisible();
    expect(await screen.findByText(/Connected/)).toBeVisible();
    await user.click(cont());

    expect(await screen.findByRole("heading", { name: "Decks Vuurtoren reads" })).toBeVisible();
    const core = await screen.findByRole("checkbox", { name: /Dutch::Core 2k/ });
    expect(core).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Opmaat::Thema 01/ })).not.toBeChecked();
    expect(screen.getByText("de fiets · gezellig · lopen")).toBeVisible();
    // Untick one suggestion
    await user.click(screen.getByRole("checkbox", { name: /A Frequency Dictionary/ }));
    await user.click(cont());

    expect(await screen.findByRole("heading", { name: "Where new words go" })).toBeVisible();
    expect(screen.getByLabelText("Default deck")).toHaveValue("Vuurtoren::Nederlands");
    await user.click(screen.getByRole("radio", { name: "One deck per course" }));
    await user.click(screen.getByRole("button", { name: "Save and continue" }));

    // Decks were chosen: no placement check.
    expect(await screen.findByRole("heading", { name: "You are ready" })).toBeVisible();
    expect(saveLanguageProfile).toHaveBeenCalledTimes(1);
    const p = saveLanguageProfile.mock.calls[0]![0];
    expect(p.sources.map((s) => s.deck)).toEqual(["Dutch::Core 2k"]);
    expect(p.sources[0]).toMatchObject({
      modelName: "Basic (and reversed card)",
      wordField: "Front",
    });
    expect(p.destinations.reading).toBe("Vuurtoren::Nederlands::Reading");
    expect(p.courseDecks).toBe("course");
    expect(p.tags).toEqual(["nl"]);
    expect(p.mode).toBe("connected");

    await user.click(screen.getByRole("button", { name: "Add a text of your own" }));
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
    await user.click(await screen.findByRole("button", { name: "Yes" }));
    await user.click(await screen.findByRole("radio", { name: /Keep using Anki/ }));
    await user.click(cont());
    expect(await screen.findByText(/Anki is not running/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Check again" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Continue without Anki" }));

    expect(await screen.findByText(/Vuurtoren starts fresh/)).toBeVisible();
    expect(suggestDecks).not.toHaveBeenCalled();
    await user.click(cont());
    await user.click(await screen.findByRole("button", { name: "Save and continue" }));
    expect(saveLanguageProfile.mock.calls[0]![0].sources).toEqual([]);

    expect(await screen.findByRole("heading", { name: "Words you already know" })).toBeVisible();
    await user.click(await screen.findByRole("checkbox", { name: /het huis/ }));
    await user.click(screen.getByRole("checkbox", { name: /gezellig/ }));
    await user.click(screen.getByRole("button", { name: "Continue with 2 known" }));
    await waitFor(() => expect(savePlacement).toHaveBeenCalledWith(["huis", "gezellig"]));
    expect(await screen.findByRole("heading", { name: "You are ready" })).toBeVisible();
  });

  it("no Anki: three steps to a story at your level, no Anki and no deck questions", async () => {
    const ankiStatus = vi.fn(async () => ({ connected: true, state: "connected" as const }));
    const { user, saveLanguageProfile, history } = setup({ ankiStatus });
    await user.click(await screen.findByRole("button", { name: "No" }));
    expect(
      await screen.findByRole("heading", { name: "You start with the 500 most common words" }),
    ).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Where new words go" })).toBeNull();
    const p = saveLanguageProfile.mock.calls[0]![0];
    expect(p).toMatchObject({ mode: "native", sources: [] });
    expect(ankiStatus).not.toHaveBeenCalled();
    expect(screen.queryByText(/Anki/)).toBeNull();
    // Start reading is on this screen: the story at the learner's level opens, not Read.
    await user.click(screen.getByRole("button", { name: "Start reading" }));
    await waitFor(() => expect(history.location.pathname).toMatch(/^\/read\//));
  });

  it("no Anki: adds every level of the most common words, new words from the first 500", async () => {
    const addStarterLevels = vi.fn(async () => ({ added: 4930, skipped: 0 }));
    const { user, history } = setup({ addStarterLevels });
    await user.click(await screen.findByRole("button", { name: "No" }));
    expect(
      await screen.findByRole("heading", { name: "You start with the 500 most common words" }),
    ).toBeVisible();
    // No level question and nothing to untick: Check your level in Words does that (m5).
    expect(screen.queryByText("Where should new words start?")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText(/In Words, use Check your level/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Back" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Skip this" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Skip setup for now" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Start reading" }));
    await waitFor(() =>
      expect(addStarterLevels).toHaveBeenCalledWith(
        { levels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], from: 1 },
        expect.any(Function),
      ),
    );
    // No "You are ready" screen: the story opens.
    await waitFor(() => expect(history.location.pathname).toMatch(/^\/read\//));
  });

  it("while the words are added, the choices wait and the count shows", async () => {
    let finish: () => void = () => {};
    const addStarterLevels = vi.fn(
      (_req: unknown, onProgress?: (done: number, total: number) => void) =>
        new Promise<{ added: number; skipped: number }>((resolve) => {
          onProgress?.(1500, 4930);
          finish = () => resolve({ added: 4930, skipped: 0 });
        }),
    );
    const { user, history } = setup({ addStarterLevels });
    await user.click(await screen.findByRole("button", { name: "No" }));
    await screen.findByRole("heading", { name: "You start with the 500 most common words" });
    await user.click(screen.getByRole("button", { name: "Start reading" }));
    expect(await screen.findByText("Adding words… 1,500 of 4,930")).toBeVisible();
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Start reading" })).toBeDisabled();
    act(() => finish());
    await waitFor(() => expect(history.location.pathname).toMatch(/^\/read\//));
  });

  it("on a phone: Connect to your server after the Anki question, Not now goes on", async () => {
    const real = currentDevice();
    vi.mocked(currentDevice).mockReturnValue({ ...real, kind: "android" });
    try {
      const { user } = setup();
      await user.click(await screen.findByRole("button", { name: "No" }));
      expect(await screen.findByRole("heading", { name: "Connect your phone" })).toBeVisible();
      expect(screen.getByText("Your phone needs a computer or a server to read new texts."));
      expect(await screen.findByLabelText("Pairing code")).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Not now" }));
      expect(
        await screen.findByRole("heading", { name: "You start with the 500 most common words" }),
      ).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Back" }));
      expect(await screen.findByRole("heading", { name: "Connect your phone" })).toBeVisible();
    } finally {
      vi.mocked(currentDevice).mockImplementation(() => real);
    }
  });

  it("on a phone, Yes to Anki offers a deck file (.apkg) or Vuurtoren's cards, not AnkiConnect", async () => {
    const real = currentDevice();
    vi.mocked(currentDevice).mockReturnValue({ ...real, kind: "android" });
    try {
      const { user, saveLanguageProfile } = setup();
      await user.click(await screen.findByRole("button", { name: "Yes" }));
      expect(await screen.findByRole("heading", { name: "Connect your phone" })).toBeVisible();
      expect(saveLanguageProfile.mock.calls[0]![0].mode).toBe("native");
      await user.click(screen.getByRole("button", { name: "Not now" }));
      expect(await screen.findByRole("heading", { name: "Your Anki cards" })).toBeVisible();
      expect(screen.getByText(/works only with Anki on a computer/)).toBeVisible();
      expect(screen.getByLabelText("Choose a file")).toHaveAttribute("accept", ".apkg,.colpkg");
      expect(screen.queryByRole("heading", { name: "Connect Anki" })).toBeNull();
      await user.click(cont());
      expect(
        await screen.findByRole("heading", { name: "You start with the 500 most common words" }),
      ).toBeVisible();
    } finally {
      vi.mocked(currentDevice).mockImplementation(() => real);
    }
  });

  it("saving a step the flow no longer shows goes forward, not back to the server step", async () => {
    const real = currentDevice();
    vi.mocked(currentDevice).mockReturnValue({ ...real, kind: "android" });
    // Where an older build left a phone: Where new words go, after Continue without Anki.
    localStorage.setItem(
      "vuurtoren.onboarding",
      JSON.stringify({ step: "destinations", usesAnki: false, move: true }),
    );
    try {
      const { user } = setup();
      await user.click(await screen.findByRole("button", { name: "Save and continue" }));
      expect(
        await screen.findByRole("heading", { name: "You start with the 500 most common words" }),
      ).toBeVisible();
      expect(screen.queryByRole("heading", { name: "Connect your phone" })).toBeNull();
    } finally {
      vi.mocked(currentDevice).mockImplementation(() => real);
    }
  });

  it("not on a phone: no server step", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "No" }));
    expect(
      await screen.findByRole("heading", { name: "You start with the 500 most common words" }),
    ).toBeVisible();
  });

  it("import from Anki: confirmed decks are moved into Vuurtoren", async () => {
    const moveFromAnki = vi.fn(async () => ({
      notes: 10,
      cards: 20,
      reviews: 300,
      vocabNotes: 10,
      media: 0,
      skippedMedia: 0,
    }));
    const { user, saveLanguageProfile } = setup({ moveFromAnki });
    await user.click(await screen.findByRole("button", { name: "Yes" }));
    expect(
      await screen.findByRole("radio", { name: /Import from Anki and use Vuurtoren/ }),
    ).toBeChecked();
    await user.click(cont());
    expect(await screen.findByText(/Connected/)).toBeVisible();
    await user.click(cont());
    await screen.findByRole("checkbox", { name: /Dutch::Core 2k/ });
    await user.click(cont());
    await user.click(await screen.findByRole("button", { name: "Save and continue" }));
    expect(await screen.findByRole("heading", { name: "Importing your decks" })).toBeVisible();
    expect(saveLanguageProfile.mock.calls[0]![0].mode).toBe("connected");
    await user.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByText(/Imported 20 cards from 10 notes/)).toBeVisible();
    expect(moveFromAnki).toHaveBeenCalledTimes(1);
    await user.click(cont());
    expect(await screen.findByRole("heading", { name: "You are ready" })).toBeVisible();
  });

  it("resumes at the saved step and can't be skipped", async () => {
    localStorage.setItem("vuurtoren.onboarding", JSON.stringify({ step: "anki" }));
    setup();
    expect(await screen.findByRole("heading", { name: "Connect Anki" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Skip setup for now" })).toBeNull();
  });

  it("brings the learner back to an unfinished onboarding, even with a profile saved", async () => {
    // The profile is saved after "Do you use Anki?"; leaving later must not land in the app.
    localStorage.setItem(
      "vuurtoren.onboarding",
      JSON.stringify({ step: "starter", usesAnki: false }),
    );
    const base = createMockServices({ latencyMs: 0 });
    const history = createMemoryHistory({ initialEntries: ["/words"] });
    render(<App services={base} history={history} />);
    await waitFor(() => expect(history.location.pathname).toBe("/welcome"));
  });

  it("is never shown in demo mode or once a profile exists", async () => {
    const base = createMockServices({ latencyMs: 0 });
    const history = createMemoryHistory({ initialEntries: ["/words"] });
    render(
      <App services={{ ...base, languageProfile: async () => null }} history={history} demo />,
    );
    expect(await screen.findByRole("navigation", { name: "Main" })).toBeVisible();
    expect(history.location.pathname).toBe("/words");
  });
});
