import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WordInspector } from "./WordInspector.js";
import { BAND_LABEL, difficultyBand } from "./CoverageMeter.js";
import type { InspectorEntry } from "@app/core";

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
  it("right after Add: ✓ Added and Undo in place of the main button", () => {
    const onUndo = vi.fn();
    render(<WordInspector entry={entry} onUndo={onUndo} />);
    expect(screen.getByText("✓ Added")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledOnce();
  });

  it("shows an empty hint without an entry", () => {
    render(<WordInspector entry={null} />);
    expect(screen.getByText(/Select a word/)).toBeInTheDocument();
  });

  it("hides Recall for a word not being learned", () => {
    render(<WordInspector entry={{ ...entry, state: "unknown", glosses: [] }} />);
    expect(screen.queryByText(/Recall/)).toBeNull();
    expect(screen.getByText("No meaning yet")).toBeInTheDocument();
  });

  it("renders the entry details", () => {
    const { container } = render(<WordInspector entry={entry} />);
    // The dictionary word on top, the page's form under it (RD2).
    expect(screen.getByRole("heading", { name: "het huis" })).toBeInTheDocument();
    expect(container.querySelector(".k-inspector-lemma")).toHaveTextContent("huizen");
    expect(screen.getByText("house")).toBeInTheDocument();
    // Short deck names, a plain part of speech; Recall only while learning.
    expect(screen.getByText("Core 2k")).toBeInTheDocument();
    expect(screen.getByText("noun")).toBeInTheDocument();
    expect(screen.queryByText("NOUN")).toBeNull();
    expect(screen.getByText("Recall 62%")).toBeInTheDocument();
    expect(container.querySelector("mark")?.textContent).toBe("huizen");
  });

  it("says quietly where a guessed meaning came from", () => {
    const guess = {
      ...entry,
      surface: "woordeloos",
      lemma: "woordeloos",
      glosses: ["wordless"],
      glossNote: "from woord + -loos",
      sentenceGloss: "speechless",
    };
    const { container } = render(<WordInspector entry={guess} />);
    const items = [...container.querySelectorAll(".k-inspector-glosses li")].map(
      (li) => li.textContent,
    );
    expect(items).toEqual(["wordless · from woord + -loos", "speechless · in this sentence"]);
  });

  it("lists the word's latest reviews in native mode", () => {
    const at = new Date(2026, 10, 3).getTime();
    render(
      <WordInspector
        entry={{
          ...entry,
          anki: {
            ...entry.anki,
            status: "review",
            native: true,
            reviews: [
              { at, rating: 1, interval: "10m" },
              { at: at - 86_400_000, rating: 3, interval: "4d" },
            ],
          },
        }}
      />,
    );
    expect(screen.getByText("Your reviews")).toBeInTheDocument();
    const rows = screen
      .getAllByRole("listitem")
      .filter((li) => /Again|Good/.test(li.textContent ?? ""));
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/Again10m$/),
      expect.stringMatching(/Good4d$/),
    ]);
  });

  it("shows the sentence translation when present", () => {
    render(<WordInspector entry={{ ...entry, sentenceTranslation: "I call my sister." }} />);
    expect(screen.getByText("I call my sister.")).toBeInTheDocument();
  });

  it("fires actions", async () => {
    const onAdd = vi.fn();
    const onMark = vi.fn();
    render(<WordInspector entry={entry} onAddToAnki={onAdd} onMarkKnown={onMark} />);
    await userEvent.click(screen.getByRole("button", { name: "Add to Anki" }));
    await userEvent.click(screen.getByRole("button", { name: "I know it" }));
    expect(onAdd).toHaveBeenCalledOnce();
    expect(onMark).toHaveBeenCalledOnce();
    // No Ignore button (m5): it said nothing and confused people.
    expect(screen.queryByRole("button", { name: "Ignore" })).toBeNull();
  });
});

describe("WordInspector Anki states", () => {
  const withAnki = (a: Partial<InspectorEntry["anki"]>, e: Partial<InspectorEntry> = {}) => ({
    ...entry,
    ...e,
    anki: { ...entry.anki, ...a },
  });
  const names = () => screen.getAllByRole("button").map((b) => b.textContent);

  it("absent: Add to Anki and I know it, nothing more", () => {
    render(<WordInspector entry={entry} />);
    expect(names()).toEqual(["Add to Anki", "I know it"]);
  });

  it("a word ignored earlier can be brought back", async () => {
    const onReset = vi.fn();
    render(<WordInspector entry={{ ...entry, state: "ignored" }} onReset={onReset} />);
    await userEvent.click(screen.getByRole("button", { name: "Stop ignoring" }));
    expect(onReset).toHaveBeenCalledOnce();
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
    expect(names()).toEqual(["Study first in Anki", "I know it"]);
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
    expect(names()).toEqual(["Unsuspend & study first", "I know it"]);
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
    expect(names()).toEqual(["I know it"]);
    unmount();
    render(
      <WordInspector
        entry={withAnki(
          { status: "review", detail: "In review · due in 30 days" },
          { state: "known" },
        )}
      />,
    );
    expect(screen.queryAllByRole("button")).toEqual([]);
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
    expect(names()).toEqual(["Use Anki\u2019s state"]);
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
    expect(screen.getByRole("button", { name: "I know it" })).toBeDisabled();
  });

  it("disables the Anki actions while busy", () => {
    render(<WordInspector entry={entry} busy />);
    expect(screen.getByRole("button", { name: "Add to Anki" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "I know it" })).toBeDisabled();
  });
});

describe("difficultyBand", () => {
  it("maps coverage to bands", () => {
    expect(BAND_LABEL[difficultyBand(0.99)]).toBe("Comfortable");
    expect(BAND_LABEL[difficultyBand(0.96)]).toBe("Stretch");
    expect(BAND_LABEL[difficultyBand(0.92)]).toBe("Challenging");
    expect(BAND_LABEL[difficultyBand(0.85)]).toBe("Very challenging");
  });

  it("a new word opens on its Word tab", async () => {
    const panel = <p>The sentence</p>;
    const { rerender } = render(<WordInspector entry={entry} card={{}} sentencePanel={panel} />);
    await userEvent.click(screen.getByRole("tab", { name: "Sentence" }));
    expect(screen.getByRole("tab", { name: "Sentence" })).toHaveAttribute("aria-selected", "true");
    rerender(
      <WordInspector
        entry={{ ...entry, tokenIndex: 4, key: "zijn", surface: "zijn", lemma: "zijn" }}
        card={{}}
        sentencePanel={panel}
      />,
    );
    expect(screen.getByRole("tab", { name: "Word" })).toHaveAttribute("aria-selected", "true");
  });
});
