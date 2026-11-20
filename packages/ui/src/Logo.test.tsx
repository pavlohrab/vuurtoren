import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LOGO_GRID_48, Logo, LogoMark, ProgressRing, logoGrid, ringArc } from "./Logo.js";

describe("Logo", () => {
  it("the mark is an ink k with an accent bookmark ribbon for a leg", () => {
    const { container } = render(<LogoMark size={48} />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("viewBox", "0 0 48 48");
    expect(container.querySelector(".k-logo-k")).toHaveAttribute("d", LOGO_GRID_48.ink);
    // The ribbon is drawn first (it tucks under the arm) and ends in a swallow-tail: five points.
    const ribbon = container.querySelector(".k-logo-ribbon")!;
    expect(svg.firstElementChild).toBe(ribbon);
    expect(ribbon.getAttribute("d")!.match(/[ML]/g)).toHaveLength(5);
  });

  it("uses the small-size cuts at favicon and rail sizes", () => {
    const { container, rerender } = render(<LogoMark size={16} />);
    expect(container.querySelector("svg")).toHaveAttribute("viewBox", "0 0 16 16");
    rerender(<LogoMark size={24} />);
    expect(container.querySelector("svg")).toHaveAttribute("viewBox", "0 0 24 24");
    expect(logoGrid(33)).toBe(LOGO_GRID_48);
  });

  it("full logo has the wordmark and one accessible name", () => {
    render(<Logo />);
    expect(screen.getByRole("img", { name: "Vuurtoren" })).toHaveTextContent("vuurtoren");
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
