import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Logo, LogoMark, ProgressRing, ringArc } from "./Logo.js";

describe("Logo", () => {
  it("the mark is the 3/4 brand ring by default", () => {
    const { container } = render(<LogoMark size={48} />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("data-coverage", "0.75");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    // Ring starts at 12 o'clock and ends at 3 o'clock (counter-clockwise, gap at top right).
    expect(container.querySelector(".k-logo-ring")).toHaveAttribute(
      "d",
      "M24 5.5A18.5 18.5 0 1 0 42.5 24",
    );
  });

  it("a coverage value sets and animates the ring, clamped to [0, 1]", () => {
    const { container, rerender } = render(<LogoMark size={64} coverage={0.42} />);
    const svg = () => container.querySelector("svg")!;
    expect(svg()).toHaveAttribute("data-coverage", "0.42");
    expect(svg()).toHaveClass("k-logo-mark--live");
    expect(container.querySelector(".k-logo-track")).not.toBeNull();
    rerender(<LogoMark size={64} coverage={1.4} />);
    expect(svg()).toHaveAttribute("data-coverage", "1");
    rerender(<LogoMark size={64} coverage={0} />);
    expect(container.querySelector(".k-logo-ring")).toBeNull();
  });

  it("uses the small-size cuts at favicon and rail sizes", () => {
    const { container, rerender } = render(<LogoMark size={16} />);
    expect(container.querySelector("svg")).toHaveAttribute("viewBox", "0 0 16 16");
    rerender(<LogoMark size={24} />);
    expect(container.querySelector("svg")).toHaveAttribute("viewBox", "0 0 24 24");
  });

  it("full logo has the wordmark and one accessible name", () => {
    render(<Logo />);
    expect(screen.getByRole("img", { name: "Kenning" })).toHaveTextContent("kenning");
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
