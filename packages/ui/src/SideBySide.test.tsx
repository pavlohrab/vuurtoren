import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SentencePairs } from "@app/core";
import { SideBySide } from "./SideBySide.js";
import { fixture } from "./test-fixtures.js";

const TEXT = "Morgen bel ik mijn moeder op. Omdat het gisteren zo hard regende, bleven we binnen.";

/** Two sentences; "op" is the particle of "bel". */
function setup() {
  const f = fixture(TEXT, {}, { 5: 1 });
  const dot = f.tokens.find((t) => t.text === ".")!.i;
  for (const t of f.tokens) if (t.i > dot) t.sent = 1;
  const plan = f.plans[0]!;
  // The second sentence is hard: "bleven" and "binnen" are not known.
  for (const p of plan.tokens) {
    const word = f.tokens[p.i]!.text;
    if (word === "bleven" || word === "binnen") Object.assign(p, { label: "new", pKnown: 0 });
  }
  const at = (w: string, from = 0) => f.tokens.find((t) => t.text === w && t.i >= from)!.i;
  const en = (english: string) =>
    [...english.matchAll(/[\p{L}]+|'[\p{L}]+|[^\p{L}\s]/gu)].map((m) => ({
      start: m.index,
      end: m.index + m[0].length,
      text: m[0],
    }));
  const omdat = at("Omdat");
  const pairs = new Map<number, SentencePairs>([
    [
      0,
      {
        sent: 0,
        english: "Tomorrow I'll call my mom.",
        englishTokens: en("Tomorrow I'll call my mom."),
        pairs: [
          { nl: [at("Morgen")], en: [0], confidence: 0.6 },
          { nl: [at("bel"), at("op")], en: [2, 3], confidence: 0.7 },
          { nl: [at("ik")], en: [1], confidence: 0.8 },
          { nl: [at("moeder")], en: [5], confidence: 0.9 },
        ],
        source: "offline",
      },
    ],
    [
      1,
      {
        sent: 1,
        english: "Because it rained so hard yesterday, we stayed inside.",
        englishTokens: en("Because it rained so hard yesterday, we stayed inside."),
        pairs: [
          { nl: [omdat], en: [0], confidence: 0.7 },
          { nl: [at("regende")], en: [2], confidence: 0.9 },
          { nl: [at("bleven")], en: [9], confidence: 0.9 },
        ],
        source: "offline",
      },
    ],
  ]);
  return { ...f, plan, pairs };
}

const dutch = (word: string) =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-side="nl"]')).find(
    (el) => el.textContent === word,
  )!;
const english = (word: string) =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-side="en"]')).find(
    (el) => el.textContent === word,
  )!;

describe("SideBySide", () => {
  it("shows each sentence as a row with its English", () => {
    const s = setup();
    const { container } = render(<SideBySide {...s} visibility="always" />);
    const rows = container.querySelectorAll(".k-sbs-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.querySelector(".k-sbs-nl")?.textContent).toBe("Morgen bel ik mijn moeder op.");
    expect(rows[0]?.querySelector(".k-sbs-en")?.textContent).toBe("Tomorrow I'll call my mom.");
    // Words are real buttons with a label naming their partner.
    expect(dutch("bel")).toHaveAccessibleName("bel (English: 'll call)");
    expect(english("call")).toHaveAccessibleName("call (Dutch: bel op)");
  });

  it("hovering a Dutch word lights up its English, and both parts of a separable verb", async () => {
    const s = setup();
    render(<SideBySide {...s} visibility="always" />);
    await userEvent.hover(dutch("bel"));
    expect(english("call")).toHaveAttribute("data-active");
    expect(english("'ll")).toHaveAttribute("data-active");
    expect(dutch("op")).toHaveAttribute("data-active");
    expect(english("mom")).not.toHaveAttribute("data-active");
    await userEvent.unhover(dutch("bel"));
    expect(english("call")).not.toHaveAttribute("data-active");
  });

  it("hovering or tapping an English word lights up its Dutch partner", async () => {
    const s = setup();
    render(<SideBySide {...s} visibility="always" />);
    await userEvent.hover(english("rained"));
    expect(dutch("regende")).toHaveAttribute("data-active");
    await userEvent.unhover(english("rained"));
    expect(dutch("regende")).not.toHaveAttribute("data-active");
    // A tap pins the pair until the next tap.
    fireEvent.click(english("call"));
    expect(english("call")).toHaveAttribute("aria-pressed", "true");
    expect(dutch("bel")).toHaveAttribute("data-active");
    expect(dutch("op")).toHaveAttribute("data-active");
    fireEvent.click(english("call"));
    expect(dutch("bel")).not.toHaveAttribute("data-active");
  });

  it("clicking a Dutch word opens the inspector and keeps its pair lit", async () => {
    const s = setup();
    const onTokenClick = vi.fn();
    render(<SideBySide {...s} visibility="always" onTokenClick={onTokenClick} />);
    fireEvent.click(dutch("moeder"));
    expect(onTokenClick).toHaveBeenCalledWith(s.tokens.find((t) => t.text === "moeder")!.i);
    expect(english("mom")).toHaveAttribute("data-active");
  });

  it("arrow keys move along a side, up and down jump to the partner", async () => {
    const s = setup();
    render(<SideBySide {...s} visibility="always" />);
    dutch("Morgen").focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(dutch("bel")).toHaveFocus();
    expect(english("call")).toHaveAttribute("data-active");
    await userEvent.keyboard("{ArrowDown}");
    expect(english("'ll")).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(dutch("bel")).toHaveFocus();
  });

  it("only hard sentences show their English by default; the others have Show English", async () => {
    const s = setup();
    const { container } = render(<SideBySide {...s} />);
    const [easy, hard] = Array.from(container.querySelectorAll<HTMLElement>(".k-sbs-row"));
    expect(within(hard!).getByText("rained")).toBeInTheDocument();
    expect(within(easy!).queryByText("call")).toBeNull();
    await userEvent.click(within(easy!).getByRole("button", { name: "Show English" }));
    expect(within(easy!).getByText("call")).toBeInTheDocument();
  });

  it("Tap to show hides every English until asked; Always shows all", async () => {
    const s = setup();
    const { rerender } = render(<SideBySide {...s} visibility="tap" />);
    expect(screen.getAllByRole("button", { name: "Show English" })).toHaveLength(2);
    expect(screen.queryByText("rained")).toBeNull();
    rerender(<SideBySide {...s} visibility="always" />);
    expect(screen.queryByRole("button", { name: "Show English" })).toBeNull();
  });

  it("the structure view colours each pair and adds the word-order note", async () => {
    const s = setup();
    const notes = new Map([
      [1, { label: "Verb at the end", note: "After «Omdat» the verb «regende» moves to the end." }],
    ]);
    const { container } = render(<SideBySide {...s} visibility="always" notes={notes} />);
    const hard = container.querySelectorAll<HTMLElement>(".k-sbs-row")[1]!;
    const toggle = within(hard).getByRole("button", { name: "Structure" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(hard).toHaveAttribute("data-structure");
    expect(dutch("Omdat")).toHaveAttribute("data-pc", "1");
    expect(english("Because")).toHaveAttribute("data-pc", "1");
    expect(dutch("regende")).toHaveAttribute("data-pc", "2");
    expect(english("rained")).toHaveAttribute("data-pc", "2");
    expect(within(hard).getByText(/moves to the end/)).toBeInTheDocument();
    // The first sentence is untouched; Alt-click on a word turns its structure on.
    expect(dutch("bel")).not.toHaveAttribute("data-pc");
    fireEvent.click(dutch("bel"), { altKey: true });
    expect(dutch("bel")).toHaveAttribute("data-pc", "2");
    expect(dutch("op")).toHaveAttribute("data-pc", "2");
    await userEvent.click(toggle);
    expect(hard).not.toHaveAttribute("data-structure");
  });

  it("says so when a sentence has no translation", () => {
    const s = setup();
    const pairs = new Map(s.pairs);
    pairs.set(1, { sent: 1, english: "", englishTokens: [], pairs: [], source: "offline" });
    render(<SideBySide {...s} pairs={pairs} visibility="always" />);
    expect(screen.getByText("No translation for this sentence.")).toBeInTheDocument();
  });
});
