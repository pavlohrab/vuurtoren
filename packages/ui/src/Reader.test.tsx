import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Reader, learningOpacity, matchAnswer } from "./Reader.js";
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
    const input = screen.getByLabelText(/Fill in the missing word/);
    await userEvent.type(input, "bel{Enter}");
    expect(onClozeAnswer).toHaveBeenCalledWith(1, "bel", 0);
    const shown = screen.getByText("bel");
    expect(shown).toHaveAttribute("data-result", "correct");
  });

  it("flags a wrong cloze answer", async () => {
    const f = fixture(TEXT, { 1: "cloze" });
    const { container } = render(<Reader {...f} onClozeAnswer={() => {}} />);
    await userEvent.type(screen.getByLabelText(/Fill in the missing word/), "bal{Enter}");
    const shown = container.querySelector('[data-result="incorrect"]');
    expect(shown?.textContent).toBe("balbel");
    expect(shown?.querySelector("s")?.textContent).toBe("bal");
  });

  it("shows the meaning as a hint, then the first letter, then the word", async () => {
    const f = fixture(TEXT, { 1: "cloze" });
    const onClozeAnswer = vi.fn();
    const { container } = render(
      <Reader {...f} glosses={{ 1: "to call" }} onClozeAnswer={onClozeAnswer} />,
    );
    expect(screen.getByRole("tooltip")).toHaveTextContent("to call");
    const input = screen.getByLabelText(/Fill in the missing word/);
    expect(input).toHaveAccessibleDescription("to call");
    await userEvent.type(input, "?");
    expect(input).toHaveAttribute("placeholder", "b _ _");
    await userEvent.type(input, "bel{Enter}");
    expect(onClozeAnswer).toHaveBeenLastCalledWith(1, "bel", 1);

    const f2 = fixture(TEXT, { 1: "cloze" });
    const { container: c2 } = render(<Reader {...f2} onClozeAnswer={onClozeAnswer} />);
    const hintBtn = c2.querySelector<HTMLButtonElement>(".k-cloze-hintbtn")!;
    await userEvent.click(hintBtn);
    await userEvent.click(c2.querySelector<HTMLButtonElement>(".k-cloze-hintbtn")!);
    // second step: half of the word ("bel" -> 2 letters)
    expect(c2.querySelector("input.k-cloze")).toHaveAttribute("placeholder", "b e _");
    await userEvent.click(c2.querySelector<HTMLButtonElement>(".k-cloze-hintbtn")!);
    expect(onClozeAnswer).toHaveBeenLastCalledWith(1, "", 3);
    expect(c2.querySelector('[data-result="revealed"]')?.textContent).toBe("bel");
    expect(container).toBeTruthy();
  });

  it("shows blanks only where asked: cloze mode by default, gloss mode only with blanks on", () => {
    const f = fixture(TEXT, { 1: "cloze" });
    const { rerender } = render(<Reader {...f} mode="gloss" />);
    expect(screen.queryByLabelText(/Fill in the missing word/)).toBeNull();
    rerender(<Reader {...f} mode="gloss" blanks />);
    expect(screen.getByLabelText(/Fill in the missing word/)).toBeInTheDocument();
    rerender(<Reader {...f} mode="cloze" />);
    expect(screen.getByLabelText(/Fill in the missing word/)).toBeInTheDocument();
  });

  it("shows the word for revealed clozes", () => {
    const f = fixture(TEXT, { 1: "cloze" });
    render(<Reader {...f} revealed={new Set([1])} />);
    expect(screen.queryByLabelText(/Fill in the missing word/)).toBeNull();
    expect(screen.getByText("bel")).toBeInTheDocument();
  });

  it("keeps the particle of a cloze verb visible as a normal word", () => {
    const f = fixture(TEXT, { 1: "cloze" }, { 4: 1 });
    render(<Reader {...f} />);
    // One blank for the verb only; the particle is plain text with its own (known) label.
    expect(screen.getAllByLabelText(/Fill in the missing word/)).toHaveLength(1);
    const particle = screen.getByText("op");
    expect(particle).toHaveAttribute("data-label", "known");
    expect(particle).toHaveClass("k-tok--particle");
  });

  it("moves focus to the next blank after Enter, then to the answered word", async () => {
    const f = fixture(TEXT, { 1: "cloze", 3: "cloze" });
    render(<Reader {...f} />);
    const [first, second] = screen.getAllByLabelText(/Fill in the missing word/);
    await userEvent.type(first!, "bel{Enter}");
    expect(second).toHaveFocus();
    await userEvent.type(second!, "morgen{Enter}");
    expect(screen.getByText("morgen")).toHaveFocus();
  });

  it("accepts missing diacritics and Unicode normalisation", () => {
    expect(matchAnswer("Bel", "bel")).toBe("exact");
    expect(matchAnswer("een", "\u00e9\u00e9n")).toBe("accents");
    expect(matchAnswer("e\u0301e\u0301n", "\u00e9\u00e9n")).toBe("exact");
    expect(matchAnswer("bal", "bel")).toBe("incorrect");
  });
});
