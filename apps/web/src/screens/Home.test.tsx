import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../App.js";
import { createMockServices } from "../services/mock.js";
import type { AppServices, TextListItem } from "../services/types.js";
import { greeting, libraryCoverage, pagesOf, pickContinue } from "./Home.js";

function setup(patch: Partial<AppServices> = {}, synced = true) {
  const services: AppServices = { ...createMockServices({ latencyMs: 0, synced }), ...patch };
  render(<App services={services} history={createMemoryHistory({ initialEntries: ["/"] })} />);
  return services;
}

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
  ...over,
});

describe("Home helpers", () => {
  it("greets by the time of day, in Dutch", () => {
    expect(greeting(8)).toBe("Goedemorgen");
    expect(greeting(14)).toBe("Goedemiddag");
    expect(greeting(20)).toBe("Goedenavond");
    expect(greeting(2)).toBe("Goedenavond");
  });

  it("continues the last text, else one in progress, else the easiest", () => {
    const a = text({ id: "a", coverage: 0.8 });
    const b = text({ id: "b", coverage: 0.95 });
    const c = text({ id: "c", lastSegment: 1 });
    expect(pickContinue([a, b, c], "a")).toEqual({ text: a, started: false });
    expect(pickContinue([a, b, c], null)).toEqual({ text: c, started: true });
    expect(pickContinue([a, b], null)).toEqual({ text: b, started: false });
    expect(pickContinue([], null)).toBeNull();
  });

  it("estimates pages and weights library coverage by length", () => {
    expect(pagesOf({ wordCount: 320, lastSegment: 1 })).toEqual({ pages: 3, page: 2, done: 1 / 3 });
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

describe("Home", () => {
  it("shows the plan, continue reading and the known-words ring from the services", async () => {
    setup();
    expect(await screen.findByRole("heading", { level: 1, name: /^Goede/ })).toBeVisible();
    const plan = await screen.findByRole("region", { name: "Today" });
    const practise = await within(plan).findByRole("link", { name: /Practise/ });
    expect(practise).toHaveAttribute("href", "/practice");
    const reading = screen.getByRole("region", { name: /^(Continue reading|Next to read)$/ });
    expect(
      within(reading).getAllByRole("link", {
        name: /Op de markt|Een dag|Het weer|Start|Continue/,
      })[0],
    ).toHaveAttribute("href", expect.stringMatching(/^\/read\//));
    expect(within(reading).getByRole("link", { name: /Not this one\? Library/ })).toHaveAttribute(
      "href",
      "/library",
    );
    const ring = await screen.findByRole("meter", { name: /words in your texts you already know/ });
    await waitFor(() => expect(Number(ring.getAttribute("aria-valuenow"))).toBeGreaterThan(0));
    const words = screen.getByRole("region", { name: "Your words" });
    // One primary action on the page: continue (or start) the text.
    expect(document.querySelectorAll(".home .k-btn--primary")).toHaveLength(1);
    expect(within(words).getByText("Known")).toBeInTheDocument();
    expect(within(words).getByRole("link", { name: /View progress/ })).toHaveAttribute(
      "href",
      "/progress",
    );
    expect(within(words).getByRole("link", { name: "1,892" })).toHaveAttribute(
      "href",
      "/words?state=known",
    );
  });

  it("lays out words to learn, recent texts and one quiet line of more", async () => {
    setup();
    const learn = await screen.findByRole("region", { name: "Words to learn now" });
    const chips = await within(learn).findAllByRole("link", { name: /\w/ });
    expect(chips.some((a) => /^\/words\?/.test(a.getAttribute("href") ?? ""))).toBe(true);
    const recent = screen.getByRole("region", { name: "Recent texts" });
    const covers = await within(recent).findAllByRole("link", { name: /% known|Het weer|Een dag/ });
    expect(covers[0]).toHaveAttribute("href", expect.stringMatching(/^\/read\//));
    const more = screen.getByRole("region", { name: "More for today" });
    const week = within(more).getByRole("region", { name: "This week" });
    expect(await within(week).findByRole("link", { name: /of 7 days active/ })).toHaveAttribute(
      "href",
      "/progress",
    );
    const grammar = within(more).getByRole("region", { name: "Grammar in your texts" });
    expect(
      await within(grammar).findByRole("link", { name: /seen \d+ time|Browse grammar/ }),
    ).toHaveAttribute("href", expect.stringMatching(/^\/grammar/));
    const talk = within(more).getByRole("region", { name: "Talk about it" });
    const go = await within(talk).findByRole("link", { name: /Start talking|Set up AI/ });
    expect(go.getAttribute("href")).toMatch(/^\/(talk|settings)/);
  });

  it("links the current course unit", async () => {
    setup();
    const plan = await screen.findByRole("region", { name: "Today" });
    const unit = await within(plan).findByRole("link", { name: /Unit \d+/ });
    expect(unit.getAttribute("href")).toMatch(/^\/courses\/[^/]+\/\d+$/);
  });

  it("a brand-new learner gets two first steps instead of empty numbers", async () => {
    setup(
      {
        listTexts: async () => [],
        learnerSummary: async () => ({
          known: 0,
          learning: 0,
          unknown: 0,
          vocabEstimate: 0,
          lastSync: null,
          sources: [],
        }),
      },
      false,
    );
    expect(await screen.findByRole("link", { name: /Connect Anki/ })).toHaveAttribute(
      "href",
      "/settings?section=language",
    );
    expect(screen.getByRole("link", { name: /Import a text/ })).toHaveAttribute("href", "/import");
    expect(screen.queryByRole("region", { name: "Today" })).toBeNull();
  });
});
