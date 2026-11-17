import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Reader, learningOpacity } from "./Reader.js";
import { fixture } from "./test-fixtures.js";

const TEXT = "Ik bel je morgen op.\n\nHet huis is groot.";

describe("Reader", () => {
  it("renders source text faithfully and splits paragraphs on blank lines", () => {
    const f = fixture(TEXT);
    const { container } = render(<Reader {...f} />);
    const paras = container.querySelectorAll("p");
    expect(paras).toHaveLength(2);
    expect(paras[0]?.textContent).toBe("Ik bel je morgen op.");
    expect(paras[1]?.textContent).toBe("Het huis is groot.");
  });

  it("marks word-state labels", () => {
    const f = fixture(TEXT, { 1: "introduce", 3: "new", 6: "learning", 7: "gloss" });
    render(<Reader {...f} />);
    expect(screen.getByText("bel")).toHaveAttribute("data-label", "introduce");
    expect(screen.getByText("morgen")).toHaveAttribute("data-label", "new");
    expect(screen.getByText("huis")).toHaveAttribute("data-label", "learning");
    expect(screen.getByText("is")).toHaveAttribute("data-label", "gloss");
    expect(screen.getByText("Ik")).toHaveAttribute("data-label", "known");
  });

  it("styles a detached particle like its verb", () => {
    const f = fixture(TEXT, { 1: "introduce" }, { 4: 1 });
    render(<Reader {...f} />);
    const particle = screen.getByText("op");
    expect(particle).toHaveAttribute("data-label", "introduce");
    expect(particle).toHaveClass("k-tok--particle");
  });

  it("clamps learning opacity to 0.25..1", () => {
    expect(learningOpacity(0.99)).toBe(0.25);
    expect(learningOpacity(0)).toBe(1);
    expect(learningOpacity(0.5)).toBe(0.5);
  });

  it("calls onTokenClick with the token index", async () => {
    const f = fixture(TEXT);
    const onTokenClick = vi.fn();
    render(<Reader {...f} onTokenClick={onTokenClick} />);
    await userEvent.click(screen.getByText("huis"));
    expect(onTokenClick).toHaveBeenCalledWith(f.tokens.find((t) => t.text === "huis")?.i);
  });

  it("marks the selected token", () => {
    const f = fixture(TEXT);
    const sel = f.tokens.find((t) => t.text === "huis")?.i ?? -1;
    render(<Reader {...f} selectedToken={sel} />);
    expect(screen.getByText("huis")).toHaveAttribute("data-selected", "true");
    expect(screen.getByText("Het")).toHaveAttribute("data-selected", "false");
  });

  it("submits a cloze answer on Enter and reveals the word", async () => {
    const f = fixture(TEXT, { 1: "cloze" });
    const onClozeAnswer = vi.fn();
    render(<Reader {...f} onClozeAnswer={onClozeAnswer} />);
    const input = screen.getByLabelText("Fill in the missing word");
    await userEvent.type(input, "bel{Enter}");
    expect(onClozeAnswer).toHaveBeenCalledWith(1, "bel");
    const shown = screen.getByText("bel");
    expect(shown).toHaveAttribute("data-result", "correct");
  });

  it("flags a wrong cloze answer", async () => {
    const f = fixture(TEXT, { 1: "cloze" });
    render(<Reader {...f} onClozeAnswer={() => {}} />);
    await userEvent.type(screen.getByLabelText("Fill in the missing word"), "bal{Enter}");
    expect(screen.getByText("bel")).toHaveAttribute("data-result", "incorrect");
  });

  it("shows the word for revealed clozes", () => {
    const f = fixture(TEXT, { 1: "cloze" });
    render(<Reader {...f} revealed={new Set([1])} />);
    expect(screen.queryByLabelText("Fill in the missing word")).toBeNull();
    expect(screen.getByText("bel")).toBeInTheDocument();
  });
});
