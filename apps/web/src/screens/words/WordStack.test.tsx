import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../../App.js";
import { createMockServices } from "../../services/mock.js";
import type { AppServices, InspectorEntry } from "../../services/types.js";
import { saveAnswer } from "./WordStack.js";
import { loadStarterIndex } from "./WordsRoom.js";

function setup(url = "/words") {
  const services: AppServices = createMockServices({ latencyMs: 0, native: true });
  const markKnown = vi.spyOn(services, "markKnown");
  const learnNext = vi.spyOn(services, "learnNext");
  const addToAnki = vi.spyOn(services, "addToAnki");
  const history = createMemoryHistory({ initialEntries: [url] });
  const view = render(<App services={services} history={history} />);
  return { services, markKnown, learnNext, addToAnki, history, view, user: userEvent.setup() };
}

const card = () => screen.findByRole("group", { name: /Swipe right/ });
const wordOf = async () => (await card()).querySelector("h2")?.textContent ?? "";
/** The top card with its details loaded (its sentence or meaning shown), focused. */
async function ready(): Promise<void> {
  await waitFor(async () =>
    expect((await card()).querySelector(".word-stack-meaning")?.textContent).not.toBe(""),
  );
  (await card()).focus();
}

describe("the word stack", () => {
  it("opens Your words as cards; → is I know it, saved when the next answer comes", async () => {
    const { markKnown, user } = setup();
    expect(await screen.findByRole("radio", { name: "Met while reading" })).toBeChecked();
    const first = await wordOf();
    await ready();
    await user.keyboard("{ArrowRight}");
    expect(await screen.findByRole("status")).toHaveTextContent(/Marked as known/);
    // Waiting for Undo: nothing saved yet, and the next word is on top.
    expect(markKnown).not.toHaveBeenCalled();
    await waitFor(async () => expect(await wordOf()).not.toBe(first));
    await ready();
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(markKnown).toHaveBeenCalledTimes(1));
    expect(markKnown.mock.calls[0]![0].key).toBe(first.replace(/^(de|het) /, ""));
  });

  it("Undo brings the card back and saves nothing", async () => {
    const { markKnown, learnNext, addToAnki, user, view } = setup();
    const first = await wordOf();
    await user.click(screen.getByRole("button", { name: /Keep learning/ }));
    expect(await screen.findByRole("status")).toHaveTextContent(/Kept for learning/);
    await user.click(screen.getByRole("button", { name: /Undo/ }));
    await waitFor(async () => expect(await wordOf()).toBe(first));
    expect(screen.queryByRole("status")).toBeNull();
    view.unmount();
    expect(learnNext).not.toHaveBeenCalled();
    expect(addToAnki).not.toHaveBeenCalled();
    expect(markKnown).not.toHaveBeenCalled();
  });

  it("leaving the page saves the waiting answer", async () => {
    const { learnNext, addToAnki, user, view } = setup();
    await card();
    await user.click(screen.getByRole("button", { name: /Keep learning/ }));
    await screen.findByRole("status");
    view.unmount();
    await waitFor(() => expect(addToAnki.mock.calls.length + learnNext.mock.calls.length).toBe(2));
  });

  it("the search icon opens the list with its search field ready", async () => {
    const { history, user } = setup();
    await user.click(await screen.findByRole("button", { name: "Find a word" }));
    await waitFor(() => expect(history.location.search).toContain("layout=list"));
    expect(await screen.findByLabelText("Search")).toHaveFocus();
  });
});

describe("saveAnswer", () => {
  const entry = (status: InspectorEntry["anki"]["status"]) =>
    ({ key: "fiets", anki: { status, noteIds: [1], cardIds: [2] } }) as InspectorEntry;
  const services = () => {
    const s = createMockServices({ latencyMs: 0 });
    return {
      ...s,
      markKnown: vi.fn(async () => ({})),
      learnNext: vi.fn(async () => ({ deck: "d" })),
      addToAnki: vi.fn(async () => ({ noteId: 1, deck: "d" })),
      inspectWord: vi.fn(async () => entry("new")),
    } satisfies AppServices;
  };

  it("I know it is the word sheet's mark known, with the chosen deck", async () => {
    const s = services();
    await saveAnswer(s, entry("review"), "known", "Mijn woorden");
    expect(s.markKnown).toHaveBeenCalledWith(entry("review"), { deck: "Mijn woorden" });
  });

  it("Keep learning: Study first for a new card; add first without one; nothing while learning", async () => {
    const s = services();
    await saveAnswer(s, entry("new"), "learn", undefined);
    expect(s.learnNext).toHaveBeenCalledTimes(1);
    await saveAnswer(s, entry("absent"), "learn", undefined);
    expect(s.addToAnki).toHaveBeenCalledTimes(1);
    expect(s.learnNext).toHaveBeenCalledTimes(2);
    await saveAnswer(s, entry("learning"), "learn", undefined);
    await saveAnswer(s, entry("review"), "learn", undefined);
    expect(s.learnNext).toHaveBeenCalledTimes(2);
    expect(s.markKnown).not.toHaveBeenCalled();
  });
});

describe("the word stack's first set and order", () => {
  it("with nothing met while reading yet, opens on the current starter level", async () => {
    const services: AppServices = {
      ...createMockServices({ latencyMs: 0, native: true }),
      wordsToDecide: async () => [],
    };
    render(
      <App services={services} history={createMemoryHistory({ initialEntries: ["/words"] })} />,
    );
    const level = await screen.findByRole("radio", { name: /^Level \d+$/, checked: true });
    expect(screen.getByRole("radio", { name: "Met while reading" })).not.toBeChecked();
    const summary = await screen.findByLabelText("Where you are");
    await waitFor(() => expect(summary).toHaveTextContent(level.textContent!));
  });

  it("New is most common first (starter rank), not alphabetical", async () => {
    const index = await loadStarterIndex();
    const byRank = [...index.rank.entries()].sort((a, b) => a[1] - b[1]);
    const common = byRank[3]![0];
    const rarer = byRank[400]![0];
    const base = createMockServices({ latencyMs: 0, native: true });
    const words: AppServices["words"] = async (opts = {}) =>
      opts.state === "unknown"
        ? [
            { key: "zzz-niet-in-de-lijst", state: "unknown" },
            { key: rarer, state: "unknown" },
            { key: common, state: "unknown" },
          ].map((w) => ({ ...w, gloss: "" }) as Awaited<ReturnType<AppServices["words"]>>[number])
        : opts.state === "seen"
          ? []
          : base.words(opts);
    render(
      <App
        services={{ ...base, words }}
        history={createMemoryHistory({ initialEntries: ["/words"] })}
      />,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: "New" }));
    await waitFor(async () => expect(await wordOf()).toMatch(new RegExp(`${common}$`)));
  });

  it("the header follows a saved answer and says known once", async () => {
    const { user } = setup();
    const summary = await screen.findByLabelText("Where you are");
    await waitFor(() => expect(summary).toHaveTextContent(/of [\d,]+ known/));
    expect(summary.textContent!.match(/known/g)).toHaveLength(1);
    const before = summary.textContent;
    await ready();
    await user.keyboard("{ArrowRight}");
    await ready();
    // The next answer saves the first at once; then the header is asked again.
    await user.keyboard("{ArrowLeft}");
    await waitFor(() => expect(summary.textContent).not.toBe(before));
  });
});
