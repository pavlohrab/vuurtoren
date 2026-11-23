import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "../App.js";
import { createMockServices } from "../services/mock.js";
import type { AppServices } from "../services/types.js";

function setup(path: string, patch: Partial<AppServices> = {}, synced = false) {
  const services: AppServices = { ...createMockServices({ latencyMs: 0, synced }), ...patch };
  render(<App services={services} history={createMemoryHistory({ initialEntries: [path] })} />);
  return userEvent.setup();
}

const emptySummary = {
  known: 0,
  learning: 0,
  unknown: 0,
  vocabEstimate: 200,
  lastSync: null,
  sources: [],
};

describe("empty states", () => {
  it("Progress: one next step and no made-up estimate before a first sync", async () => {
    setup("/progress", { learnerSummary: async () => emptySummary });
    expect(await screen.findByRole("heading", { name: "Nothing to measure yet" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Set up your words" })).toBeInTheDocument();
    expect(screen.queryByText("Estimated vocabulary")).toBeNull();
  });

  it("Progress: the estimate appears once Anki was synced", async () => {
    setup("/progress", {}, true);
    expect(await screen.findByText("Estimated vocabulary")).toBeInTheDocument();
    expect(screen.getByText(/Anki collection, synced/)).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Known words" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Reading per week" })).toBeInTheDocument();
  });

  it("Words: a real empty state when there are no words at all", async () => {
    setup("/words/all?layout=list", { words: async () => [], wordsToDecide: async () => [] });
    expect(await screen.findByRole("heading", { name: "No words yet" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Add text" })).toBeInTheDocument();
  });

  it("the main nav: the two rooms, then the quieter places; Talk only with AI", async () => {
    setup("/", { listTexts: async () => [] });
    await screen.findByRole("heading", { name: "No texts of your own yet" });
    const nav = screen.getByRole("navigation", { name: "Main" });
    const names = () =>
      within(nav)
        .getAllByRole("link")
        .map((l) => l.getAttribute("title"))
        .filter(Boolean);
    // One Words entry (the phone tab bar: Read · Words · More); Practice is a tab of Words.
    await waitFor(() =>
      expect(names()).toEqual([
        "Read",
        "Words",
        "Grammar",
        "Exam",
        "Courses",
        "Talk",
        "Support Vuurtoren",
        "Settings",
      ]),
    );
    expect(within(nav).getByRole("link", { name: "Read" })).toHaveAttribute("data-active");
    expect(within(nav).queryByRole("link", { name: "Library" })).toBeNull();
    expect(within(nav).queryByRole("link", { name: "Progress" })).toBeNull();
  });

  it("Progress belongs to Words, with the way back to it; Talk hides without AI", async () => {
    setup("/progress", {
      aiStatus: async () => ({ configured: false, provider: null, model: null }) as never,
    });
    const nav = await screen.findByRole("navigation", { name: "Main" });
    await waitFor(() =>
      expect(within(nav).getByRole("link", { name: /^Words/ })).toHaveAttribute("data-active"),
    );
    expect(within(nav).queryByRole("link", { name: "Talk" })).toBeNull();
    expect(await screen.findByRole("link", { name: "Words" })).toHaveAttribute("href", "/words");
  });

  it("the demo (synced) shows no Connect Anki banner", async () => {
    setup("/", {}, true);
    await screen.findAllByRole("link", { name: "Het weer" });
    expect(screen.queryByRole("button", { name: "Connect Anki" })).toBeNull();
  });

  it("one h1 per page: the top-bar title is not a heading", async () => {
    setup("/");
    await screen.findByRole("heading", { level: 1, name: "Read" });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});

describe("plain errors", () => {
  it("Import: plain cause, Retry and details; no stale progress", async () => {
    const user = setup("/import", {
      importText: async (_input, onProgress) => {
        onProgress?.("Analysing the text…");
        throw new Error("NLP /analyze/text: HTTP 502, not JSON: ");
      },
    });
    await user.type(await screen.findByLabelText("Text"), "Ik bel mijn zus op.");
    await user.click(screen.getByRole("button", { name: "Add to my texts" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The import did not work.");
    expect(alert).toHaveTextContent(/language server is not reachable/);
    expect(within(alert).getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(within(alert).getByText("Technical details")).toBeInTheDocument();
    expect(screen.queryByText("Analysing the text…")).toBeNull();
  });
});
