import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { readSupport, writeSupport } from "../../support.js";
import { SupportCard } from "./SupportCard.js";

describe("SupportCard", () => {
  beforeEach(() => localStorage.clear());

  it("stays away before 10 days of use", () => {
    writeSupport({ days: 3, lastDay: "2026-11-23", askedAt: null, never: false });
    render(<SupportCard />);
    expect(screen.queryByText("Vuurtoren is made by one person.")).toBeNull();
  });

  it("shows after 10 days, links to Ko-fi, and Not now waits for the next ask", () => {
    writeSupport({ days: 10, lastDay: "2026-11-23", askedAt: null, never: false });
    render(<SupportCard />);
    expect(screen.getByRole("link", { name: "Support" })).toHaveAttribute(
      "href",
      "https://ko-fi.com/pavlohrab",
    );
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByText("Vuurtoren is made by one person.")).toBeNull();
    expect(readSupport()).toMatchObject({ askedAt: 10, never: false });
  });

  it("Don't ask again is final", () => {
    writeSupport({ days: 10, lastDay: "2026-11-23", askedAt: null, never: false });
    render(<SupportCard />);
    fireEvent.click(screen.getByRole("button", { name: "Don't ask again" }));
    expect(readSupport().never).toBe(true);
  });
});
