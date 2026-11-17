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
  anki: {
    status: "absent",
    noteIds: [],
    cardIds: [],
    prioritized: false,
    markedKnown: false,
    overridden: false,
  },
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

  it("shows the sentence translation when present", () => {
    render(<WordInspector entry={{ ...entry, sentenceTranslation: "I call my sister." }} />);
    expect(screen.getByText("I call my sister.")).toBeInTheDocument();
  });

  it("fires actions", async () => {
    const onAdd = vi.fn();
    const onMark = vi.fn();
    const onSet = vi.fn();
    render(
      <WordInspector entry={entry} onAddToAnki={onAdd} onMarkKnown={onMark} onSetState={onSet} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Add to Anki" }));
    await userEvent.click(screen.getByRole("button", { name: "Mark known" }));
    await userEvent.click(screen.getByRole("button", { name: "Ignore" }));
    expect(onAdd).toHaveBeenCalledOnce();
    expect(onMark).toHaveBeenCalledOnce();
    expect(onSet).toHaveBeenCalledExactlyOnceWith("ignored");
  });
});

describe("WordInspector Anki states", () => {
  const withAnki = (a: Partial<InspectorEntry["anki"]>, e: Partial<InspectorEntry> = {}) => ({
    ...entry,
    ...e,
    anki: { ...entry.anki, ...a },
  });
  const names = () => screen.getAllByRole("button").map((b) => b.textContent);

  it("absent: Add to Anki, Mark known (with its hint), Ignore", () => {
    render(<WordInspector entry={entry} />);
    expect(names()).toEqual(["Add to Anki", "Mark known", "Ignore"]);
    expect(screen.getByText("Adds it to Anki as known")).toBeInTheDocument();
  });

  it("new: Study first in Anki with the deck hint", async () => {
    const onLearn = vi.fn();
    render(
      <WordInspector
        entry={withAnki({
          status: "new",
          detail: "New card · in A Frequency Dictionary of Dutch",
          deck: "A Frequency Dictionary of Dutch",
          noteIds: [1],
          cardIds: [10],
        })}
        onLearnNext={onLearn}
      />,
    );
    expect(names()).toEqual(["Study first in Anki", "Mark known", "Ignore"]);
    expect(
      screen.getByText("Moves its card to the front of ‘A Frequency Dictionary of Dutch’"),
    ).toBeInTheDocument();
    expect(screen.getByText("New card · in A Frequency Dictionary of Dutch")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Study first in Anki" }));
    expect(onLearn).toHaveBeenCalledOnce();
  });

  it("suspended: Unsuspend & study first", () => {
    render(
      <WordInspector
        entry={withAnki({ status: "suspended", detail: "Suspended", noteIds: [1] })}
      />,
    );
    expect(names()).toEqual(["Unsuspend & study first", "Mark known", "Ignore"]);
  });

  it("learning and young review: status line and Mark known; mature or known: no Mark known", () => {
    const { unmount } = render(
      <WordInspector
        entry={withAnki(
          { status: "review", detail: "In review · due in 6 days" },
          { state: "learning" },
        )}
      />,
    );
    expect(screen.getByText("In review · due in 6 days")).toBeInTheDocument();
    expect(names()).toEqual(["Mark known", "Ignore"]);
    unmount();
    render(
      <WordInspector
        entry={withAnki(
          { status: "review", detail: "In review · due in 30 days" },
          { state: "known" },
        )}
      />,
    );
    expect(names()).toEqual(["Ignore"]);
  });

  it("marked known: no Mark known, and a link back to Anki's state", async () => {
    const onReset = vi.fn();
    render(
      <WordInspector
        entry={withAnki(
          { status: "review", markedKnown: true, overridden: true },
          { state: "known" },
        )}
        onReset={onReset}
      />,
    );
    expect(names()).toEqual(["Ignore", "Use Anki\u2019s state"]);
    await userEvent.click(screen.getByRole("button", { name: /Use Anki.s state/ }));
    expect(onReset).toHaveBeenCalledOnce();
  });

  it("unavailable: shows the reason and disables the actions", () => {
    render(
      <WordInspector
        entry={withAnki({
          status: "unavailable",
          detail: "cannot reach http://127.0.0.1:8765",
          noteIds: [1],
        })}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Anki not reachable. cannot reach http://127.0.0.1:8765",
    );
    expect(screen.getByRole("button", { name: "Study first in Anki" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Mark known" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Ignore" })).toBeEnabled();
  });

  it("disables the Anki actions while busy", () => {
    render(<WordInspector entry={entry} busy />);
    expect(screen.getByRole("button", { name: "Add to Anki" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Mark known" })).toBeDisabled();
  });
});

describe("difficultyBand", () => {
  it("maps coverage to bands", () => {
    expect(BAND_LABEL[difficultyBand(0.99)]).toBe("Comfortable");
    expect(BAND_LABEL[difficultyBand(0.96)]).toBe("Stretch");
    expect(BAND_LABEL[difficultyBand(0.92)]).toBe("Challenging");
    expect(BAND_LABEL[difficultyBand(0.85)]).toBe("Very challenging");
  });
});
