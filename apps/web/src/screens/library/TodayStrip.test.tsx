import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../App.js";
import { createMockServices } from "../../services/mock.js";
import type { AppServices, TextListItem } from "../../services/types.js";
import { libraryCoverage } from "../Progress.js";
import { shelfRows } from "./shelving.js";
import { reviewMinutes } from "./TodayStrip.js";
import { pagesOf, pickContinue, readingNow, readingState } from "../../textPages.js";

function setup(patch: Partial<AppServices> = {}, opts: { native?: boolean } = {}) {
  const services: AppServices = {
    ...createMockServices({ latencyMs: 0, synced: true, ...opts }),
    ...patch,
  };
  const history = createMemoryHistory({ initialEntries: ["/"] });
  render(<App services={services} history={history} />);
  return { services, history };
}

afterEach(() => localStorage.clear());

const text = (over: Partial<TextListItem>): TextListItem => ({
  id: "t",
  title: "T",
  lang: "nl",
  sourceKind: "paste",
  createdAt: 0,
  wordCount: 300,
  analyzed: true,
  lastSegment: 0,
  coverage: 0.9,
  newTypes: 3,
  pages: null,
  ...over,
});

describe("Today helpers", () => {
  it("continues a text in progress, never a finished one; else the next to read", () => {
    const a = text({ id: "a", coverage: 0.8 });
    const b = text({ id: "b", coverage: 0.95 });
    const c = text({ id: "c", lastSegment: 1, pages: 3 });
    const done = text({ id: "done", lastSegment: 3, pages: 3 });
    expect(pickContinue([a, b, c], "a")).toEqual({ text: c, started: true });
    expect(pickContinue([a, b, done], "done")).toEqual({ text: b, started: false });
    expect(pickContinue([a, b], "a")).toEqual({ text: a, started: false });
    expect(pickContinue([done], "done")).toBeNull();
  });

  it("uses one rule for Continue reading and the Reading now shelf", () => {
    const x = text({ id: "x", lastSegment: 1, pages: 4 });
    const y = text({ id: "y", lastSegment: 2, pages: 4 });
    const texts = [x, y, text({ id: "done", lastSegment: 4, pages: 4 })];
    const shelf = shelfRows(texts, [], "y").find((r) => r.id === "auto:reading")!;
    expect(shelf.texts.map((t) => t.id)).toEqual(["y", "x"]);
    expect(pickContinue(texts, "y")?.text).toBe(shelf.texts[0]);
    expect(readingNow(texts, null).map((t) => t.id)).toEqual(["x", "y"]);
  });

  it("counts pages from the reading plan and weights library coverage by length", () => {
    expect(pagesOf({ wordCount: 320, lastSegment: 1, pages: 5 })).toEqual({
      pages: 5,
      page: 2,
      done: 1 / 5,
    });
    expect(pagesOf({ wordCount: 320, lastSegment: 1 })).toEqual({ pages: 3, page: 2, done: 1 / 3 });
    expect(readingState({ wordCount: 320, lastSegment: 5, pages: 5 }).kind).toBe("done");
    expect(
      libraryCoverage([
        text({ wordCount: 100, coverage: 1 }),
        text({ wordCount: 300, coverage: 0.8 }),
        text({ coverage: null }),
      ]),
    ).toBeCloseTo(0.85);
    expect(libraryCoverage([text({ coverage: null })])).toBeNull();
  });
});

describe("Read: the Today strip", () => {
  it("opens on Read with the text to continue, what is due, and one primary action", async () => {
    setup();
    expect(await screen.findByRole("heading", { level: 1, name: "Read" })).toBeVisible();
    const today = await screen.findByRole("region", { name: "Today" });
    const go = await within(today).findByRole("link", { name: /^(Continue|Start reading)/ });
    expect(go).toHaveAttribute("href", expect.stringMatching(/^\/read\//));
    const steps = within(today).getByRole("list", { name: "Today" });
    expect(within(steps).queryByText(/Level \d+/)).toBeNull();
    // Connected to Anki: the exercises due stand in for reviews.
    expect(await within(steps).findByText(/exercises? due/)).toBeInTheDocument();
    expect(document.querySelectorAll(".library .k-btn--primary")).toHaveLength(1);
    // Then the stories at the learner's level, then the learner's own texts.
    expect(screen.getByRole("heading", { level: 2, name: "Stories for you" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "Your texts" })).toBeVisible();
  });

  it("shows what is due today and about how long it takes (native)", async () => {
    setup({}, { native: true });
    const today = await screen.findByRole("region", { name: "Today" });
    const review = await within(today).findByRole("link", {
      name: /^Due today · \d+ cards? · ~\d+ min/,
    });
    expect(review).toHaveAttribute("href", "/review");
  });

  it("offers a story at the learner's level when there is nothing to continue", async () => {
    const { history } = setup({ listTexts: async () => [] });
    const today = await screen.findByRole("region", { name: "Today" });
    expect(await within(today).findByText(/A story at your level/)).toBeInTheDocument();
    await userEvent.click(within(today).getByRole("button", { name: /Start reading/ }));
    await waitFor(() => expect(history.location.pathname).toMatch(/^\/read\//));
  });

  it("asks to finish setting up while there is no language profile", async () => {
    localStorage.setItem("vuurtoren.onboarding.skipped", "1");
    setup({ languageProfile: async () => null });
    expect(await screen.findByRole("link", { name: /Finish setting up/ })).toHaveAttribute(
      "href",
      "/welcome",
    );
  });
});
