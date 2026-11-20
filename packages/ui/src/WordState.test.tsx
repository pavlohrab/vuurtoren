import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnkiStatusChip, Lemma, WORD_STATE_LABEL, WordStateChip } from "./WordState.js";
import { CoverageMeter } from "./CoverageMeter.js";
import { TextCard } from "./TextCard.js";

describe("WordStateChip", () => {
  it("uses one sentence-case label per state", () => {
    expect(WORD_STATE_LABEL).toEqual({
      known: "Known",
      learning: "Learning",
      toLearn: "To learn",
      unknown: "New",
      seen: "New",
      ignored: "Ignored",
    });
    render(<WordStateChip state="unknown" />);
    expect(screen.getByText("New")).toHaveAttribute("data-state", "unknown");
  });

  it("names words learned only in Vuurtoren", () => {
    render(<WordStateChip state="learning" inVuurtoren />);
    expect(screen.getByText("Learning (in Vuurtoren)")).toHaveAttribute("data-state", "learning");
  });

  it("shows a count with the lowercased label", () => {
    render(<WordStateChip state="toLearn" count={3} />);
    expect(screen.getByText("3 to learn")).toHaveClass("k-state--toLearn");
  });

  it("keeps Anki status apart from the word state", () => {
    render(
      <>
        <AnkiStatusChip status="absent" />
        <AnkiStatusChip status="review" />
      </>,
    );
    expect(screen.getByText("Not in Anki")).toBeInTheDocument();
    expect(screen.getByText("In Anki: review")).toBeInTheDocument();
  });
});

describe("Lemma", () => {
  it("mutes the article", () => {
    render(<Lemma lemma="fiets" article="de" />);
    const el = screen.getByText("de", { exact: false, selector: ".k-lemma-article" });
    expect(el.parentElement).toHaveTextContent("de fiets");
    expect(el.parentElement).toHaveAttribute("lang", "nl");
  });
});

describe("Coverage scope", () => {
  it("labels the scope of the number", () => {
    render(<CoverageMeter value={0.819} label="This page" />);
    expect(screen.getByRole("meter", { name: "Coverage, this page" })).toBeInTheDocument();
    expect(screen.getByText("This page")).toBeInTheDocument();
  });

  it("Library cards say whole text and never suggest weave", () => {
    render(
      <TextCard title="Lang" sourceKind="paste" wordCount={900} coverage={0.761} newTypes={42} />,
    );
    expect(screen.getByRole("meter", { name: "Coverage, whole text" })).toBeInTheDocument();
    expect(screen.getByText("42 new")).toBeInTheDocument();
    expect(screen.queryByText(/weave/i)).toBeNull();
  });
});
