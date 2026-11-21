import { render, screen } from "@testing-library/react";
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
    expect(screen.getByRole("heading", { name: /het huizen/ })).toBeInTheDocument();
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
    const onSet = vi.fn();
    render(
      <WordInspector entry={entry} onAddToAnki={onAdd} onMarkKnown={onMark} onSetState={onSet} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Add to Anki" }));
    await userEvent.click(screen.getByRole("button", { name: "I know it" }));
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
    expect(names()).toEqual(["Add to Anki", "I know it", "Ignore"]);
    expect(screen.getByText(/I know it” adds it to Anki as known/)).toBeInTheDocument();
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
    expect(names()).toEqual(["Study first in Anki", "I know it", "Ignore"]);
    expect(screen.getByText("Moves its card to the front of the queue")).toBeInTheDocument();
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
    expect(names()).toEqual(["Unsuspend & study first", "I know it", "Ignore"]);
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
    expect(names()).toEqual(["I know it", "Ignore"]);
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
    expect(screen.getByRole("button", { name: "I know it" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Ignore" })).toBeEnabled();
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
});
