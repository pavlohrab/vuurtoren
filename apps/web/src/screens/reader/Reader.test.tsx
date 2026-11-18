import { createMemoryHistory } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { grammarTopic } from "@app/content";
import type { GrammarHit } from "@app/core";
import { App } from "../../App.js";
import { createMockServices } from "../../services/mock.js";
import { levelFromVocabulary, marginMarks, topicPriority } from "./grammarMarks.js";
import { DEFAULT_PREFS, readPrefs, writePrefs } from "./readerPrefs.js";

function setup(path = "/read/t-utrecht") {
  const history = createMemoryHistory({ initialEntries: [path] });
  const services = createMockServices({ latencyMs: 0 });
  render(<App services={services} history={history} />);
  return { history, services };
}

/** The first mark needs the text, its grammar and the learner summary: allow for a busy run. */
const SLOW = { timeout: 4000 };

/** The reader's token for a surface (the inspector may show the same text). */
const tok = (text: string) =>
  screen.getAllByText(text).find((el) => el.hasAttribute("data-tok")) as HTMLElement;
const page = () => document.querySelector<HTMLElement>(".reader-page")!;

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset["readingFocus"];
});

describe("grammar margin marks", () => {
  it("marks a sentence quietly; the mark underlines its hits and opens a popover", async () => {
    setup();
    const mark = await screen.findByRole("button", { name: "Grammar: Separable verbs" }, SLOW);
    // Clean text by default: nothing is underlined until the mark is opened.
    expect(tok("bel")).not.toHaveClass("k-tok--spot");
    expect(screen.getAllByRole("button", { name: /^Grammar: / })).toHaveLength(1);

    await userEvent.click(mark);
    expect(mark).toHaveAttribute("aria-expanded", "true");
    const pop = await screen.findByRole("dialog", { name: "Grammar: Separable verbs" });
    expect(within(pop).getByText(/«bel … op» is «opbellen»/)).toBeInTheDocument();
    expect(within(pop).getByRole("link", { name: "Open the topic" })).toHaveAttribute(
      "href",
      "/grammar/separable-verbs",
    );
    expect(tok("bel")).toHaveClass("k-tok--spot");
    expect(tok("op")).toHaveClass("k-tok--spot");
    expect(tok("zus")).not.toHaveClass("k-tok--spot");

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(tok("bel")).not.toHaveClass("k-tok--spot");
    expect(mark).toHaveFocus();
  });

  it("'Focus on this' marks the topic all through the text, with a count and ‹ ›", async () => {
    setup();
    await userEvent.click(
      await screen.findByRole("button", { name: "Grammar: Separable verbs" }, SLOW),
    );
    await userEvent.click(await screen.findByRole("button", { name: "Focus on this" }));
    expect(
      screen.getByRole("button", { name: "Grammar focus: Separable verbs. Change" }),
    ).toBeInTheDocument();
    const status = () =>
      within(screen.getByRole("group", { name: "Grammar focus" })).getByRole("status");
    expect(status()).toHaveTextContent("1 on this page");
    // In focus, margin marks step aside.
    expect(screen.queryByRole("button", { name: /^Grammar: / })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findAllByText("staat");
    await waitFor(() => expect(status()).toHaveTextContent("2 on this page"));
    expect(tok("neemt")).toHaveClass("k-tok--spot");
    expect(tok("trein")).not.toHaveClass("k-tok--spot");

    await userEvent.click(screen.getByRole("button", { name: "Next one" }));
    expect(status()).toHaveTextContent("1 of 2 on this page");
    expect(tok("staat")).toHaveClass("k-tok--spot-current");
    await userEvent.click(screen.getByRole("button", { name: "Next one" }));
    expect(status()).toHaveTextContent("2 of 2 on this page");
    expect(tok("neemt")).toHaveClass("k-tok--spot-current");
    expect(tok("staat")).not.toHaveClass("k-tok--spot-current");

    // Esc (with nothing selected) clears the focus.
    act(() => document.body.focus());
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(tok("neemt")).not.toHaveClass("k-tok--spot"));
    expect(screen.queryByRole("group", { name: "Grammar focus" })).toBeNull();
  });

  it("the picker (in the … menu) suggests topics and searches the ones in the text", async () => {
    setup();
    await screen.findByRole("button", { name: "Grammar: Separable verbs" }, SLOW);
    await userEvent.click(screen.getByRole("button", { name: "More reading options" }));
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Grammar focus: off. Choose" }),
    );
    const pop = await screen.findByRole("dialog", { name: "Choose a grammar topic" });
    expect(within(pop).getByText("Suggested")).toBeInTheDocument();
    expect(within(pop).getByText("In this text")).toBeInTheDocument();
    await userEvent.type(within(pop).getByRole("searchbox"), "subord");
    const option = within(pop).getByRole("option", { name: /Subordinate clauses/ });
    await userEvent.click(option);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const focus = screen.getByRole("group", { name: "Grammar focus" });
    expect(within(focus).getByRole("status")).toHaveTextContent("None on this page");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(
        within(screen.getByRole("group", { name: "Grammar focus" })).getByRole("status"),
      ).toHaveTextContent("1 on this page"),
    );
    expect(tok("omdat")).toHaveClass("k-tok--spot");
  });
});

describe("reading comforts", () => {
  it("changes and remembers size, theme and font per device", async () => {
    setup();
    await screen.findAllByText("bel");
    expect(page().style.getPropertyValue("--reader-size")).toBe("19.5px");
    await userEvent.click(screen.getByRole("button", { name: "Reading settings" }));
    const pop = await screen.findByRole("dialog", { name: "Reading settings" });
    await userEvent.click(within(pop).getByRole("button", { name: "Larger text" }));
    expect(page().style.getPropertyValue("--reader-size")).toBe("22px");
    await userEvent.click(within(pop).getByRole("radio", { name: "Sepia" }));
    expect(page()).toHaveAttribute("data-reading-theme", "sepia");
    await userEvent.click(within(pop).getByRole("radio", { name: "Atkinson" }));
    await userEvent.click(within(pop).getByRole("radio", { name: "Wide" }));
    expect(readPrefs()).toEqual({
      ...DEFAULT_PREFS,
      size: 3,
      theme: "sepia",
      font: "atkinson",
      width: "wide",
    });
    expect(page().style.getPropertyValue("--font-reading")).toMatch(/Atkinson/);
  });

  it("Ctrl/Cmd + and − step the size within its five steps", async () => {
    setup();
    await screen.findAllByText("bel");
    act(() => document.body.focus());
    for (let k = 0; k < 4; k++) fireEvent.keyDown(document.body, { key: "=", ctrlKey: true });
    expect(page().style.getPropertyValue("--reader-size")).toBe("25px");
    fireEvent.keyDown(document.body, { key: "-", metaKey: true });
    expect(readPrefs().size).toBe(3);
    fireEvent.keyDown(document.body, { key: "0", ctrlKey: true });
    expect(readPrefs().size).toBe(2);
  });

  it("falls back to the defaults when storage is broken or blocked", () => {
    localStorage.setItem("kenning-reader-prefs", "{not json");
    expect(readPrefs()).toEqual(DEFAULT_PREFS);
    localStorage.setItem("kenning-reader-prefs", JSON.stringify({ size: 99, theme: "neon" }));
    expect(readPrefs()).toEqual({ ...DEFAULT_PREFS, size: 4 });
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("blocked");
    };
    try {
      expect(() => writePrefs(DEFAULT_PREFS)).not.toThrow();
    } finally {
      Storage.prototype.setItem = orig;
    }
  });

  it("focus mode hides the chrome, dims other paragraphs and leaves on Esc", async () => {
    setup();
    await screen.findAllByText("bel");
    act(() => document.body.focus());
    fireEvent.keyDown(document.body, { key: "f" });
    expect(document.documentElement).toHaveAttribute("data-reading-focus");
    const reader = document.querySelector(".k-reader")!;
    expect(reader).toHaveClass("k-reader--focus");
    expect(reader.querySelectorAll("p[data-current]")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Leave focus mode/ })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(document.documentElement).not.toHaveAttribute("data-reading-focus"));
    expect(reader).not.toHaveClass("k-reader--focus");
  });
});

describe("marginMarks", () => {
  const hit = (topic: string, sent: number, i = sent * 10): GrammarHit => ({
    topic,
    tokens: [i],
    sent,
    start: 0,
    end: 1,
    note: "",
  });

  it("prefers topics at or just above the learner's level and never marks V2 or de/het", () => {
    const sep = grammarTopic("separable-verbs")!; // A2
    expect(topicPriority(sep, { level: "A2" })).toBeGreaterThan(
      topicPriority(sep, { level: "B1" }),
    );
    expect(topicPriority(sep, { level: "C1" })).toBe(0);
    expect(topicPriority(sep, { level: "C1", recentTopics: new Set([sep.id]) })).toBe(2);
    const marks = marginMarks(
      [hit("inversion", 0), hit("diminutives", 2), hit("separable-verbs", 4)],
      { level: "A2" },
    );
    expect([...marks.keys()]).toEqual([4]);
  });

  it("keeps at most one mark per two sentences, strongest first", () => {
    const hits = [
      hit("separable-verbs", 0), // A2
      hit("laten", 1), // B1, recent
      hit("separable-verbs", 2),
      hit("separable-verbs", 3),
      hit("position-verbs", 4),
    ];
    const marks = marginMarks(hits, { level: "A2", recentTopics: new Set(["laten"]) });
    expect([...marks.keys()]).toEqual([1, 3]);
    expect(marks.get(1)?.topic.id).toBe("laten");
    for (const s of marks.keys()) expect(marks.has(s + 1)).toBe(false);
    // Limited to the page's sentences.
    expect([...marginMarks(hits, { level: "A2" }, new Set([3, 4])).keys()]).toEqual([3]);
  });

  it("reads a rough level from the vocabulary estimate", () => {
    expect(levelFromVocabulary(0)).toBe("A2");
    expect(levelFromVocabulary(400)).toBe("A1");
    expect(levelFromVocabulary(2000)).toBe("B1");
    expect(levelFromVocabulary(9000)).toBe("C1");
  });
});
