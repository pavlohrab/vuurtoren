import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WordInspector } from "./WordInspector.js";
import { BAND_LABEL, difficultyBand } from "./CoverageMeter.js";
import type { InspectorEntry } from "./types.js";

const entry: InspectorEntry = {
  textId: "t1",
  tokenIndex: 3,
  surface: "huizen",
  lemma: "huis",
  key: "huis",
  label: "learning",
  state: "learning",
  pKnown: 0.62,
  pos: "NOUN",
  article: "het",
  glosses: ["house"],
  decks: ["Dutch::Core 2k"],
  inAnki: false,
  sentence: "De huizen zijn oud.",
  sentenceHighlight: [3, 9],
};

describe("WordInspector", () => {
  it("shows an empty hint without an entry", () => {
    render(<WordInspector entry={null} />);
    expect(screen.getByText(/Select a word/)).toBeInTheDocument();
  });

  it("renders the entry details", () => {
    const { container } = render(<WordInspector entry={entry} />);
    expect(screen.getByRole("heading", { name: /het huizen/ })).toBeInTheDocument();
    expect(screen.getByText("house")).toBeInTheDocument();
    expect(screen.getByText("Dutch::Core 2k")).toBeInTheDocument();
    expect(screen.getByText("Recall 62%")).toBeInTheDocument();
    expect(container.querySelector("mark")?.textContent).toBe("huizen");
  });

  it("fires actions", async () => {
    const onAdd = vi.fn();
    const onSet = vi.fn();
    render(<WordInspector entry={entry} onAddToAnki={onAdd} onSetState={onSet} />);
    await userEvent.click(screen.getByRole("button", { name: "Add to Anki" }));
    await userEvent.click(screen.getByRole("button", { name: "Mark known" }));
    await userEvent.click(screen.getByRole("button", { name: "Ignore" }));
    expect(onAdd).toHaveBeenCalledOnce();
    expect(onSet).toHaveBeenNthCalledWith(1, "known");
    expect(onSet).toHaveBeenNthCalledWith(2, "ignored");
  });

  it("disables Add to Anki when already in Anki", () => {
    render(<WordInspector entry={{ ...entry, inAnki: true }} />);
    expect(screen.getByRole("button", { name: "In Anki" })).toBeDisabled();
  });
});

describe("difficultyBand", () => {
  it("maps coverage to bands", () => {
    expect(BAND_LABEL[difficultyBand(0.99)]).toBe("Comfortable");
    expect(BAND_LABEL[difficultyBand(0.96)]).toBe("Stretch");
    expect(BAND_LABEL[difficultyBand(0.92)]).toBe("Challenging");
    expect(BAND_LABEL[difficultyBand(0.85)]).toBe("Weave suggested");
  });
});
