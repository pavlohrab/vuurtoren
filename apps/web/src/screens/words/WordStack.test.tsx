import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../../App.js";
import { createMockServices } from "../../services/mock.js";
import type { AppServices, InspectorEntry } from "../../services/types.js";
import { saveAnswer } from "./WordStack.js";

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
