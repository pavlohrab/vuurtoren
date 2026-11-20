import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Logo, LogoMark, ProgressRing, ringArc } from "./Logo.js";

describe("Logo", () => {
  it("the mark is a lighthouse whose beam, lamp and one lit word are accent", () => {
    const { container } = render(<LogoMark size={48} />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("viewBox", "0 0 64 64");
    expect(svg).toHaveAttribute("width", "48");
    expect(container.querySelectorAll(".k-logo-beam")).toHaveLength(3);
    // Housing, tower, base and three faint text lines are ink.
    expect(container.querySelectorAll(".k-logo-ink")).toHaveLength(6);
    expect(container.querySelectorAll('[opacity="0.3"]')).toHaveLength(3);
  });

  it("full logo has the wordmark and one accessible name", () => {
    render(<Logo />);
    const full = screen.getByRole("img", { name: "Vuurtoren" });
    // The wordmark is outlined (no web font needed) and hidden from assistive tech.
    expect(full.querySelector("svg.k-logo-word path")).toHaveAttribute("d");
    expect(full.querySelector(".k-logo-word")).toHaveAttribute("aria-hidden", "true");
    render(<Logo variant="mark" title="Home" />);
    expect(screen.getByRole("img", { name: "Home" })).toBeInTheDocument();
  });

  it("ringArc draws a full circle at 1 and a half circle at .5", () => {
    expect(ringArc(10, 5, 0.5)).toBe("M10 5A5 5 0 0 0 10 15");
    expect(ringArc(10, 5, 1)).toContain("A5 5 0 1 0 10 5");
  });

  it("ProgressRing exposes its value as a meter", () => {
    render(<ProgressRing value={0.783} label="Known" />);
    expect(screen.getByRole("meter", { name: "Known" })).toHaveAttribute("aria-valuenow", "78.3");
  });
});
