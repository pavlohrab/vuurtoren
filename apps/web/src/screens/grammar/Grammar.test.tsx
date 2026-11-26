import { createMemoryHistory } from "@tanstack/react-router";
import { configure, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { grammarTopic, grammarTopics } from "@app/content";
import type { Exercise } from "@app/core";
import { App } from "../../App.js";
import { createMockAI } from "../../services/mockAI.js";
import { createMockServices } from "../../services/mock.js";
import type { AppServices } from "../../services/types.js";
import { matchTopic, topicToPractise } from "./Grammar.js";
import { practiceOffer, splitMistake } from "./GrammarTopic.js";

// The routes are code-split: load the screens once up front, so the first test of the file
// does not spend its findBy budget on a cold dynamic import (that made it flaky under load).
beforeAll(async () => {
  configure({ asyncUtilTimeout: 5000 });
  await Promise.all([import("./Grammar.js"), import("../Practice.js"), import("../ReaderPage.js")]);
}, 30_000);
vi.setConfig({ testTimeout: 20_000 });
afterEach(() => {
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
});

/** The list rows (links) of one index section, found by its heading. */
async function shelf(name: RegExp | string): Promise<HTMLElement> {
  const h = await screen.findByRole("heading", { level: 2, name });
  return h.closest("section") as HTMLElement;
}
const rowTitles = (section: HTMLElement) =>
  [...section.querySelectorAll(".grammar-row-title")].map((e) => e.textContent);

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
    const a1 = await shelf(/A1\s+Beginner/);
    // The learning path: curriculum order within the level, a line on what the level covers.
    expect(rowTitles(a1)[0]).toBe("Spelling rules (one vowel or two)");
    expect(rowTitles(a1)).toHaveLength(grammarTopics().filter((t) => t.level === "A1").length);
    expect(a1.querySelector(".grammar-level-line")?.textContent).toMatch(/present tense/);
    expect(await shelf(/B1\s+Intermediate/)).toBeInTheDocument();
    const row = screen.getByText("Separable verbs").closest("a") as HTMLElement;
    expect(row).toHaveAttribute("href", "/grammar/separable-verbs");
    // The level heading says A2; the row does not repeat it.
    expect(within(row).queryByText("A2")).toBeNull();
    // Three separable verbs in "Een dag in Utrecht", one in "Een regenachtige dag".
    expect(await within(row).findByText("seen 4× in your texts")).toBeInTheDocument();
  });

  it("switches to topic shelves, remembers the view and filters by search", async () => {
    setup("/grammar");
    await shelf(/A1\s+Beginner/);
    await userEvent.click(screen.getByRole("tab", { name: "By topic" }));
    const order = await shelf("Word order");
    expect(rowTitles(order)).toContain("Inversion");
    // Topic shelves mix levels, so each row shows its own.
    const inversion = within(order).getByText("Inversion").closest("a") as HTMLElement;
    expect(within(inversion).getByText(grammarTopic("inversion")!.level)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /A1\s+Beginner/ })).toBeNull();
    expect(localStorage.getItem("vuurtoren.grammar.view")).toBe("topic");

    await userEvent.type(screen.getByRole("searchbox", { name: "Search topics" }), "passive");
    const titles = [...document.querySelectorAll(".grammar-row-title")].map((e) => e.textContent);
    expect(titles).toContain("The passive (worden and zijn)");
    expect(titles).not.toContain("Inversion");
    expect(screen.getByRole("status")).toHaveTextContent(`${titles.length} topics`);
    await userEvent.type(screen.getByRole("searchbox", { name: "Search topics" }), "zzz");
    expect(screen.getByText(/No topic matches/)).toBeInTheDocument();
  });

  it("opens in the remembered view", async () => {
    localStorage.setItem("vuurtoren.grammar.view", "topic");
    setup("/grammar");
    expect(await shelf("Word order")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "By topic" })).toHaveAttribute("aria-selected", "true");
  });

  it("Practise grammar opens the practisable topic seen most in your texts", async () => {
    setup("/grammar");
    const link = await screen.findByRole("link", { name: "Practise grammar" });
    expect(link.getAttribute("href")).toMatch(/^\/grammar\/[^/]+\/practice$/);

    const path = grammarTopics();
    const practisable = path.filter((t) => practiceOffer(t, false) === "practise");
    const [first, second] = practisable;
    expect(topicToPractise(path, undefined)).toBe(first);
    const counts = Object.fromEntries(second!.detects.map((d) => [d, 4]));
    const overview = { counts, textCounts: counts, texts: 2, missing: 0 };
    expect(topicToPractise(path, overview)).toBe(second);
  });

  it("matches title and summary, ignoring case, accents and Markdown", () => {
    const t = grammarTopic("present-tense")!;
    expect(matchTopic(t, "PRESENT")).toBe(true);
    expect(matchTopic(t, "stem plurals")).toBe(true);
    expect(matchTopic(t, "passive")).toBe(false);
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

  it("shows the pattern box, mistakes as pairs and the learning path; no Practise without a detector", async () => {
    setup("/grammar/present-tense");
    expect(
      (await screen.findAllByRole("heading", { level: 1, name: "The present tense" })).length,
    ).toBeGreaterThan(0);
    const box = screen.getByRole("figure", { name: "Pattern" });
    expect(within(box).getByText(/ik woon/)).toBeInTheDocument();
    // The pattern is not repeated in the explanation prose.
    expect(screen.queryByRole("heading", { level: 3, name: "Pattern" })).toBeNull();
    const mistakes = screen.getByRole("heading", { name: "Common mistakes" }).closest("section")!;
    expect(within(mistakes).getAllByText("Mistake:").length).toBeGreaterThan(1);
    expect(within(mistakes).getAllByText("Instead:").length).toBeGreaterThan(1);
    const path = screen.getByRole("navigation", { name: "Learning path" });
    expect(within(path).getByRole("link", { name: /Previous/ })).toHaveAttribute(
      "href",
      "/grammar/personal-pronouns",
    );
    expect(within(path).getByRole("link", { name: /Next/ })).toHaveAttribute(
      "href",
      "/grammar/de-het",
    );
    expect(screen.getByRole("link", { name: /Spelling rules/ })).toHaveAttribute(
      "href",
      "/grammar/spelling-rules",
    );
    expect(screen.queryByRole("link", { name: /^Practise/ })).toBeNull();
  });

  it("ends with the topic's sources, each opening in a new tab", async () => {
    setup("/grammar/relative-pronouns");
    const link = await screen.findByRole("link", { name: "e-ANS 5.8" });
    expect(link).toHaveAttribute("href", "https://e-ans.ivdnt.org/topics/pid/ans0508lingtopic");
    expect(link).toHaveAttribute("target", "_blank");
    const line = link.closest("p")!;
    expect(line).toHaveTextContent(/^Sources:/);
    expect(within(line).getAllByRole("link")).toHaveLength(
      grammarTopic("relative-pronouns")!.sources.length,
    );
    expect(within(line).getByRole("link", { name: "Taaladvies (dat / wat)" })).toHaveAttribute(
      "rel",
      "noreferrer",
    );
  });

  it("handles an unknown topic", async () => {
    setup("/grammar/nope");
    expect(await screen.findByText("This topic was not found")).toBeInTheDocument();
  });
});

describe("Topic page helpers", () => {
  it("splits a mistake into the wrong form and the fix", () => {
    expect(
      splitMistake("Adding -t after ik: _ik werkt_. With ik, use the bare stem: _ik werk_."),
    ).toEqual({
      wrong: "Adding -t after ik: _ik werkt_.",
      right: "With ik, use the bare stem: _ik werk_.",
    });
    expect(splitMistake("_Er wordt erover veel gepraat._ Let the preposition move.")).toEqual({
      wrong: "_Er wordt erover veel gepraat._",
      right: "Let the preposition move.",
    });
    expect(splitMistake("Writing 3.5 for three and a half. In Dutch it is _3,5_.").right).toBe(
      "In Dutch it is _3,5_.",
    );
    expect(splitMistake("Only one sentence here.")).toEqual({
      wrong: "Only one sentence here.",
      right: "",
    });
  });

  it("splits most mistakes on the pages into pairs without losing text", () => {
    let all = 0;
    let pairs = 0;
    for (const t of grammarTopics()) {
      const md = t.sections.find((s) => s.id === "common-mistakes")?.markdown ?? "";
      for (const line of md.split("\n").filter((l) => l.startsWith("- "))) {
        const { wrong, right } = splitMistake(line.slice(2));
        expect(`${wrong} ${right}`.trim()).toBe(line.slice(2).trim());
        all++;
        if (right) pairs++;
      }
    }
    expect(pairs / all).toBeGreaterThan(0.9);
  });

  it("offers Practise only with a detector, AI sentences only when they can be checked", () => {
    const sep = grammarTopic("separable-verbs")!;
    const present = grammarTopic("present-tense")!;
    expect(practiceOffer(sep, false)).toBe("practise");
    expect(practiceOffer(present, true)).toBeNull();
    expect(practiceOffer({ ...sep, practice: [] }, false)).toBeNull();
    expect(practiceOffer({ ...sep, practice: [] }, true)).toBeNull();
    expect(practiceOffer({ ...present, detects: ["x"], practice: [] }, true)).toBeNull();
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
      "Morgen bel ik mijn moeder op.",
      "Omdat het gisteren zo hard regende, bleven we binnen.",
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

describe("Reader grammar", () => {
  it("explains a clicked word's grammar in the inspector", async () => {
    setup("/read/t-utrecht");
    await screen.findAllByText("bel");
    await userEvent.click(tok("bel"));
    const notes = await screen.findByRole("region", { name: "Grammar of this word" });
    expect(within(notes).getByText(/^bel → bellen: present with ik/)).toBeInTheDocument();
    expect(within(notes).getByText(/^bel … op = opbellen: separable verb/)).toBeInTheDocument();
    expect(within(notes).getByText(/^Main clause: subject \(Ik\) first/)).toBeInTheDocument();
    expect(
      within(notes).getByRole("link", { name: "Open the topic: Separable verbs" }),
    ).toHaveAttribute("href", "/grammar/separable-verbs");
    // Topics without a detector hit in the text offer no focus.
    expect(
      within(notes).queryByRole("button", { name: "Focus on this: The present tense" }),
    ).toBeNull();
    // Focus on this: the reader marks that topic all through the page.
    await userEvent.click(
      within(notes).getByRole("button", { name: "Focus on this: Separable verbs" }),
    );
    const focus = await screen.findByRole("group", { name: "Grammar focus" });
    expect(within(focus).getByRole("status")).toHaveTextContent("on this page");
  });

  it("explains words without a margin mark or detector hit", async () => {
    setup("/read/t-utrecht");
    await screen.findAllByText("zus");
    await userEvent.click(tok("zus"));
    const notes = await screen.findByRole("region", { name: "Grammar of this word" });
    expect(within(notes).getByText(/^zus: a de-word \(de zus\)/)).toBeInTheDocument();
    expect(
      within(notes).getByRole("link", { name: "Open the topic: de, het and een" }),
    ).toHaveAttribute("href", "/grammar/de-het");
    expect(within(notes).getByText("More about this word")).toBeInTheDocument();
  });

  it("passes the sentence's grammar to Explain this sentence", async () => {
    // Page by page with Next: the scroll reader (book mode is one flow).
    localStorage.setItem("vuurtoren-reader-prefs", JSON.stringify({ pages: "scroll" }));
    setup("/read/t-utrecht", (s) => ({ ...s, ...createMockAI(() => Promise.resolve()) }));
    await userEvent.click(await screen.findByRole("button", { name: "Next" }));
    await screen.findAllByText("staat");
    await userEvent.click(tok("staat"));
    // Explain sits in the word sheet's Sentence tab, which lists the grammar found as well.
    await userEvent.click(await screen.findByRole("tab", { name: "Sentence" }));
    expect(await screen.findByText(/«Vandaag» comes first/)).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Explain this sentence" }));
    expect(await screen.findByText(/a mock explanation/)).toBeInTheDocument();
    // The answer's grammar list arrives formatted: an item, not a "- " line.
    await waitFor(() =>
      expect(
        [...document.querySelectorAll(".sentence-answer li")].some((li) =>
          /Inversion: «Vandaag» comes first/.test(li.textContent ?? ""),
        ),
      ).toBe(true),
    );
  });
});
