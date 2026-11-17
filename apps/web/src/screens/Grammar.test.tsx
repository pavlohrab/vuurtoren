import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Exercise } from "@app/core";
import { App } from "../App.js";
import { createMockAI } from "../services/mockAI.js";
import { createMockServices } from "../services/mock.js";
import type { AppServices } from "../services/types.js";

function setup(path: string, wrap?: (s: AppServices) => AppServices) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const base = createMockServices({ latencyMs: 0 });
  const services = wrap ? wrap(base) : base;
  render(<App services={services} history={history} />);
  return { history, services };
}

describe("Grammar index", () => {
  it("groups topics by level with hit counts from the Library", async () => {
    setup("/grammar");
    expect(await screen.findByRole("heading", { name: /A1\s+Beginner/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /B1\s+Intermediate/ })).toBeInTheDocument();
    const row = screen.getByRole("link", { name: /Separable verbs/ });
    // Three separable verbs in "Een dag in Utrecht".
    await waitFor(() => expect(within(row).getByText("3")).toBeInTheDocument());
    expect(row).toHaveAttribute("href", "/grammar/separable-verbs");
  });
});

describe("Grammar topic page", () => {
  it("renders the page, your examples before Tatoeba, and a Practise link", async () => {
    setup("/grammar/separable-verbs");
    expect(
      (await screen.findAllByRole("heading", { level: 1, name: "Separable verbs" })).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Explanation" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Common mistakes" })).toBeInTheDocument();
    // Markdown: Dutch in italics is marked as Dutch.
    expect(document.querySelector('.grammar-prose em[lang="nl"]')).not.toBeNull();

    const own = await screen.findByText((_, el) => el?.textContent === "Ik bel mijn zus op.");
    expect(within(own).getByText("bel").tagName).toBe("MARK");
    expect(screen.getAllByRole("link", { name: "Een dag in Utrecht" })[0]).toHaveAttribute(
      "href",
      "/read/t-utrecht",
    );
    const tatoeba = screen.getByText(
      (_, el) => el?.textContent === "Hij belt zijn moeder elke dag op." && el.tagName === "P",
    );
    expect(own.compareDocumentPosition(tatoeba) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("link", { name: "Practise" })).toHaveAttribute(
      "href",
      "/grammar/separable-verbs/practice",
    );
  });

  it("says so when a topic is not in your texts, and when Tatoeba is unavailable", async () => {
    setup("/grammar/imperative", (s) => ({
      ...s,
      grammarExamples: async () => ({ library: [], tatoeba: [], tatoebaUnavailable: true }),
    }));
    expect(await screen.findByText(/Not in your texts yet/)).toBeInTheDocument();
    expect(screen.getByText(/Example sentences are unavailable/)).toBeInTheDocument();
  });

  it("handles an unknown topic", async () => {
    setup("/grammar/nope");
    expect(await screen.findByText("This topic was not found")).toBeInTheDocument();
  });
});

describe("Topic exercises", () => {
  it("practises only sentences in which the topic was detected", async () => {
    let built: Exercise[] = [];
    let asked: unknown;
    setup("/grammar/inversion/practice", (s) => ({
      ...s,
      startTopicPractice: async (opts) => {
        asked = opts;
        built = await s.startTopicPractice(opts);
        return built;
      },
    }));
    expect(await screen.findByText("Put the words in order")).toBeInTheDocument();
    expect(asked).toMatchObject({ detects: ["inversion"], kinds: ["scramble"] });
    const hitSentences = new Set([
      "Vandaag staat zij vroeg op omdat de trein om acht uur vertrekt.",
      "Morgen wordt het misschien beter, zegt de weerman.",
      "Morgen ga ik naar school.",
      "Gisteren kocht hij een nieuwe fiets.",
    ]);
    expect(built.length).toBeGreaterThan(0);
    for (const e of built) expect(hitSentences).toContain(e.answer);
  });

  it("explains when there is nothing to practise", async () => {
    setup("/grammar/imperative/practice");
    expect(await screen.findByText(/no sentences with this topic/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to The imperative" })).toBeInTheDocument();
  });
});

/** The reader's token for a surface (the inspector may show the same text). */
const tok = (text: string) =>
  screen.getAllByText(text).find((el) => el.hasAttribute("data-tok")) as HTMLElement;

describe("Reader spotlights", () => {
  it("underlines grammar hits and explains them in the inspector", async () => {
    const { services } = setup("/read/t-utrecht");
    await screen.findAllByText("bel");
    await waitFor(() => expect(tok("bel")).toHaveClass("k-tok--spot"));
    const bel = tok("bel");
    expect(tok("zus")).not.toHaveClass("k-tok--spot");
    await userEvent.click(bel);
    const notes = await screen.findByRole("region", { name: "Grammar" });
    expect(within(notes).getByText("Separable verbs")).toBeInTheDocument();
    expect(
      within(notes).getByRole("link", { name: "Open the topic: Separable verbs" }),
    ).toHaveAttribute("href", "/grammar/separable-verbs");

    const toggle = screen.getByRole("button", { name: "Grammar" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(toggle);
    await waitFor(() => expect(tok("bel")).not.toHaveClass("k-tok--spot"));
    expect((await services.getSettings()).grammarSpotlights).toBe(false);
    expect(screen.queryByRole("region", { name: "Grammar" })).toBeNull();
  });

  it("passes the sentence's grammar to Explain this sentence", async () => {
    setup("/read/t-utrecht", (s) => ({ ...s, ...createMockAI(() => Promise.resolve()) }));
    await userEvent.click(await screen.findByRole("button", { name: "Next segment" }));
    await screen.findAllByText("staat");
    await userEvent.click(tok("staat"));
    await userEvent.click(await screen.findByRole("button", { name: "Explain this sentence" }));
    expect(await screen.findByText(/- Inversion: «Vandaag» comes first/)).toBeInTheDocument();
  });
});
