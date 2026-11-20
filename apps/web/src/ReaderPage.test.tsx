import { createMemoryHistory } from "@tanstack/react-router";
import { act, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { App, type AppProps } from "./App.js";
import { createMockServices } from "./services/mock.js";
import type { AppServices } from "./services/types.js";

/** The shell's word panel (inert, i.e. closed and out of reach, until a word is chosen). */
const inspector = () => screen.getByRole("complementary", { name: "Inspector", hidden: true });

function setup(
  path: string,
  wrap?: (s: AppServices) => AppServices,
  props: Partial<AppProps> = {},
) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const base = createMockServices({ latencyMs: 0 });
  const services = wrap ? wrap(base) : base;
  render(<App services={services} history={history} {...props} />);
  return { history, services };
}

// The reader route is code-split (router.tsx). Without loading it here, the first test would pay
// for the cold import of the reader's module graph inside its first findBy (Testing Library
// waits 1 s by default), which a parallel `pnpm test` can exceed. Load the screen up front, and
// give waits (and tests) a budget that holds on a loaded machine; a passing wait returns as soon
// as the element is there.
beforeAll(async () => {
  configure({ asyncUtilTimeout: 5000 });
  await import("./screens/ReaderPage.js");
}, 30_000);
vi.setConfig({ testTimeout: 20_000 });

describe("ReaderPage", () => {
  it("starts a different text from its own beginning, with no selection", async () => {
    const { history } = setup("/read/t-utrecht");
    await userEvent.click(await screen.findByRole("button", { name: "Next" }));
    expect(await screen.findByText("Page 2 of 2")).toBeInTheDocument();
    await userEvent.click(await screen.findByText("trein"));
    // Let the selected word's inspector finish loading first, so no request of the previous
    // text is still in flight when the route changes, and wait for (rather than read) the
    // state after the switch, so the test does not depend on timing.
    expect(await screen.findByRole("heading", { name: /trein/ })).toBeInTheDocument();
    await act(async () => history.push("/read/t-markt"));
    expect(await screen.findByText("Page 1 of 2")).toBeInTheDocument();
    expect(await screen.findByText(/Select a word in the text/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Add to Anki" })).toBeNull());
    // The word panel of the previous text does not stay open.
    expect(inspector()).toHaveAttribute("inert");
  });

  it("does not offer actions for the previous word while the next one loads", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    setup("/read/t-utrecht", (s) => ({
      ...s,
      inspect: async (textId, i) => {
        const entry = await s.inspect(textId, i);
        if (entry.surface === "stad") await gate;
        return entry;
      },
    }));
    await userEvent.click(await screen.findByText("zus"));
    expect(await screen.findByText("In review · due in 41 days")).toBeInTheDocument();
    await userEvent.click(screen.getByText("stad"));
    expect(await screen.findByText("Loading the word")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark known" })).toBeNull();
    await act(async () => release());
    expect(await screen.findByRole("heading", { name: /stad/ })).toBeInTheDocument();
  });

  it("shows the real error and a Retry button when the text fails to load", async () => {
    let fail = true;
    setup("/read/t-utrecht", (s) => ({
      ...s,
      getReading: async (id) => {
        if (fail) throw new Error("The database is locked");
        return s.getReading(id);
      },
    }));
    expect(await screen.findByText("The database is locked")).toBeInTheDocument();
    expect(screen.queryByText("This text was not found")).toBeNull();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Page 1 of 2")).toBeInTheDocument();
  });

  it("submits a segment once, and resumes at the next one", async () => {
    const finish = vi.fn();
    const { history } = setup("/read/t-utrecht", (s) => ({
      ...s,
      finishSegment: async (...args) => {
        finish(...args);
        return s.finishSegment(...args);
      },
    }));
    await userEvent.click(await screen.findByRole("button", { name: "Next" }));
    await userEvent.click(await screen.findByRole("button", { name: "Previous page" }));
    expect(await screen.findByText("Page 1 of 2")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Page 2 of 2")).toBeInTheDocument();
    expect(finish).toHaveBeenCalledTimes(1);
    expect(finish.mock.calls[0]?.[1]).toBe(0);

    // Leaving and coming back resumes at the segment after the finished one.
    await act(async () => history.push("/library"));
    await screen.findAllByText("Op de markt");
    await act(async () => history.push("/read/t-utrecht"));
    expect(await screen.findByText("Page 2 of 2")).toBeInTheDocument();
  });

  it("counts unanswered blanks as answered with no credit", async () => {
    const finish = vi.fn();
    setup("/read/t-utrecht", (s) => ({
      ...s,
      finishSegment: async (...args) => {
        finish(...args);
        return s.finishSegment(...args);
      },
    }));
    await userEvent.click(await screen.findByRole("tab", { name: "Cloze" }));
    await userEvent.click(screen.getByRole("button", { name: "More reading options" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Show answers" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(finish).toHaveBeenCalled());
    expect(finish.mock.calls[0]?.[2]).toMatchObject({ clozeAccuracy: 0 });
  });

  it("toasts the reason when saving progress fails", async () => {
    setup("/read/t-utrecht", (s) => ({
      ...s,
      finishSegment: async () => {
        throw new Error("Disk is full");
      },
    }));
    await userEvent.click(await screen.findByRole("button", { name: "Next" }));
    expect(await screen.findByText("Disk is full")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
  });

  it("leaves arrow keys to focused buttons", async () => {
    setup("/read/t-utrecht");
    const next = await screen.findByRole("button", { name: "Next" });
    next.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(next).toHaveFocus();
  });
});

describe("the reader bar, footer and word panel", () => {
  it("shows one slim bar: known share, mode switch, Aa and …, and no inspector toggle", async () => {
    setup("/read/t-utrecht");
    expect(await screen.findByText(/^\d+% known$/)).toHaveAttribute(
      "title",
      expect.stringMatching(/to learn on this page/),
    );
    expect(screen.getByRole("tablist", { name: "Reading mode" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Een dag in Utrecht" })).toHaveClass(
      "topbar-title--quiet",
    );
    expect(screen.queryByRole("button", { name: /inspector/i })).toBeNull();
    expect(screen.queryByText("Words to learn per page")).toBeNull();
  });

  it("Aa holds the mode's reading help as well as the reading comforts", async () => {
    const save = vi.fn();
    setup("/read/t-utrecht", (s) => ({
      ...s,
      saveSettings: async (patch) => {
        save(patch);
        return s.saveSettings(patch);
      },
    }));
    const aa = await screen.findByRole("button", { name: "Reading settings" });
    await userEvent.click(aa);
    expect(aa).toHaveAttribute("aria-expanded", "true");
    let pop = await screen.findByRole("dialog", { name: "Reading settings" });
    expect(within(pop).getByRole("region", { name: "Read mode" })).toBeInTheDocument();
    expect(within(pop).getByText("Words to learn per page")).toBeInTheDocument();
    expect(within(pop).queryByRole("slider", { name: "Translations" })).toBeNull();
    await userEvent.click(within(pop).getByRole("button", { name: "Grammar marks" }));
    expect(save).toHaveBeenCalledWith({ grammarMarks: false });
    await userEvent.keyboard("{Escape}");

    await userEvent.click(screen.getByRole("tab", { name: "Gloss" }));
    await userEvent.click(aa);
    pop = await screen.findByRole("dialog", { name: "Reading settings" });
    expect(within(pop).getByRole("region", { name: "Gloss mode" })).toBeInTheDocument();
    expect(within(pop).getByRole("slider", { name: "Translations" })).toBeInTheDocument();
    await userEvent.click(within(pop).getByRole("button", { name: "Blanks" }));
    expect(save).toHaveBeenCalledWith({ glossClozes: true });
    await userEvent.keyboard("{Escape}");

    await userEvent.click(screen.getByRole("tab", { name: "Cloze" }));
    await userEvent.click(aa);
    pop = await screen.findByRole("dialog", { name: "Reading settings" });
    const meaning = within(pop).getByRole("button", { name: "Meaning above blanks" });
    expect(meaning).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(meaning);
    expect(meaning).toHaveAttribute("aria-pressed", "false");
  });

  it("… offers focus mode, Words from this text and the shortcuts as a keyboard menu", async () => {
    const { history } = setup("/read/t-utrecht");
    const more = await screen.findByRole("button", { name: "More reading options" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    const menu = await screen.findByRole("menu", { name: "More reading options" });
    // Arrow keys move between the items.
    within(menu).getAllByRole("menuitem")[0]!.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(within(menu).getByRole("menuitem", { name: /Focus mode/ })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(document.documentElement).toHaveAttribute("data-reading-focus");
    act(() => document.body.focus());
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(document.documentElement).not.toHaveAttribute("data-reading-focus"));

    await userEvent.click(more);
    await userEvent.click(await screen.findByRole("menuitem", { name: "Keyboard shortcuts" }));
    expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");

    await userEvent.click(more);
    await userEvent.click(await screen.findByRole("menuitem", { name: "Words from this text" }));
    await screen.findByRole("heading", { name: "Words from this text" });
    expect(history.location.pathname).toBe("/read/t-utrecht/words");
  });

  it("edits the text's details from the … menu and shows the new title", async () => {
    const { services } = setup("/read/t-utrecht");
    const update = vi.spyOn(services, "updateTextMeta");
    await userEvent.click(await screen.findByRole("button", { name: "More reading options" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Edit details…" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit details" });
    const title = within(dialog).getByLabelText("Title");
    await userEvent.clear(title);
    await userEvent.type(title, "Mijn Utrecht");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("t-utrecht", { title: "Mijn Utrecht" }),
    );
    expect(await screen.findAllByText("Mijn Utrecht")).not.toHaveLength(0);
  });

  it("opens the word panel on a click and closes it with Esc, focus back on the word", async () => {
    setup("/read/t-utrecht");
    await screen.findAllByText("zus");
    expect(inspector()).toHaveAttribute("inert");
    expect(document.querySelector(".shell")).toHaveAttribute("data-inspector", "closed");
    const zus = screen.getAllByText("zus").find((el) => el.hasAttribute("data-tok"))!;
    await userEvent.click(zus);
    expect(document.querySelector(".shell")).toHaveAttribute("data-inspector", "open");
    expect(inspector()).not.toHaveAttribute("inert");
    expect(await screen.findByRole("heading", { name: /zus/ })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(inspector()).toHaveAttribute("inert"));
    expect(zus).toHaveFocus();
    expect(zus).not.toHaveAttribute("data-selected", "true");

    // The close button does the same.
    await userEvent.click(zus);
    await userEvent.click(screen.getByRole("button", { name: /Close the word panel/ }));
    await waitFor(() => expect(inspector()).toHaveAttribute("inert"));
  });

  it("the footer turns pages with ‹ › and the arrow keys; the last page says Finish", async () => {
    setup("/read/t-utrecht");
    const prev = await screen.findByRole("button", { name: "Previous page" });
    expect(prev).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("Page 2 of 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Finish" })).toBeInTheDocument();
    act(() => document.body.focus());
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    expect(await screen.findByText("Page 1 of 2")).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(await screen.findByText("Page 2 of 2")).toBeInTheDocument();
    // → on the last page does not finish the text.
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
  });
});

describe("Anki write actions in the inspector", () => {
  const buttons = () => screen.getAllByRole("button").map((b) => b.textContent);
  const ADD = "Add to Anki";
  const inspectorButtons = (...names: string[]) =>
    names.forEach((n) => expect(screen.getByRole("button", { name: n })).toBeInTheDocument());

  async function openSecondSegment() {
    await userEvent.click(await screen.findByRole("button", { name: "Next" }));
    await screen.findByText("Page 2 of 2");
  }

  it("absent word: Mark known adds it as known, then offers Use Anki's state", async () => {
    setup("/read/t-utrecht");
    await userEvent.click(await screen.findByText("grachten"));
    await screen.findByRole("button", { name: ADD });
    inspectorButtons("Mark known", "Ignore");
    expect(screen.getByText(/Mark known adds it to Anki as known/)).toBeInTheDocument();
    // No deck path on the word: the deck is named only in the Add menu.
    expect(screen.queryByText(/Vuurtoren::Nederlands/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Mark known" }));
    expect(await screen.findByText("Marked as known")).toBeInTheDocument();
    expect(await screen.findByText("Added to Anki, Reading")).toBeInTheDocument();
    expect(await screen.findByText("In review · due in 28 days")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark known" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Use Anki.s state/ }));
    expect(await screen.findByText(/Using Anki.s state/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Use Anki.s state/ })).toBeNull(),
    );
  });

  it("absent word: Add to Anki names the deck and toasts it", async () => {
    setup("/read/t-utrecht");
    await userEvent.click(await screen.findByText("grachten"));
    await userEvent.click(await screen.findByRole("button", { name: ADD }));
    expect(await screen.findByText("Added to Anki")).toBeInTheDocument();
    expect(await screen.findByText("Reading")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Study first in Anki" })).toBeInTheDocument();
  });

  it("absent word: the deck picker sends the word to another deck", async () => {
    setup("/read/t-utrecht");
    await userEvent.click(await screen.findByText("grachten"));
    await userEvent.click(await screen.findByRole("button", { name: /Choose the deck/ }));
    await userEvent.click(screen.getByRole("option", { name: /Dutch::Core 2k/ }));
    expect(screen.getByRole("button", { name: "Choose the deck (now Core 2k)" })).toBeVisible();
    await userEvent.click(await screen.findByRole("button", { name: ADD }));
    expect(await screen.findByText("Core 2k")).toBeInTheDocument();
  });

  it("new card: Study first in Anki moves it to the front", async () => {
    const learn = vi.fn();
    setup("/read/t-utrecht", (s) => ({
      ...s,
      learnNext: async (e) => {
        learn(e.anki.status);
        return s.learnNext(e);
      },
    }));
    await openSecondSegment();
    await userEvent.click(await screen.findByText("neemt"));
    expect(await screen.findByText("Moves its card to the front of the queue")).toBeInTheDocument();
    expect(buttons()).toContain("Study first in Anki");
    await userEvent.click(screen.getByRole("button", { name: "Study first in Anki" }));
    expect(await screen.findByText("Moved to the front of the queue")).toBeInTheDocument();
    expect(learn).toHaveBeenCalledWith("new");
    expect(
      await screen.findByText("New card · next in A Frequency Dictionary of Dutch"),
    ).toBeInTheDocument();
  });

  it("suspended card: Unsuspend & study first", async () => {
    setup("/read/t-utrecht");
    await openSecondSegment();
    await userEvent.click(await screen.findByText("reis"));
    inspectorButtons("Unsuspend & study first", "Mark known");
    expect(screen.getByText("Suspended")).toBeInTheDocument();
  });

  it("in progress: status line, Mark known marks it", async () => {
    setup("/read/t-utrecht");
    await openSecondSegment();
    await userEvent.click(await screen.findByText("trein"));
    expect(await screen.findByText("In review · due in 6 days")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Mark known" }));
    expect(await screen.findByText("Marked as known")).toBeInTheDocument();
  });

  it("Anki unreachable: shows the reason and disables the actions", async () => {
    setup("/read/t-utrecht");
    await openSecondSegment();
    await userEvent.click(await screen.findByText("boek"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Anki not reachable. cannot reach http://127.0.0.1:8765",
    );
    expect(screen.getByRole("button", { name: "Mark known" })).toBeDisabled();
  });

  it("explains a failed Study first in Anki in plain words", async () => {
    setup("/read/t-utrecht", (s) => ({
      ...s,
      learnNext: async () => {
        throw new Error("Learn next needs AnkiConnect with API v1 (Anki ≥ 26.08)");
      },
    }));
    await openSecondSegment();
    await userEvent.click(await screen.findByText("neemt"));
    await userEvent.click(await screen.findByRole("button", { name: "Study first in Anki" }));
    expect(
      await screen.findByText(/This needs a newer Anki and AnkiConnect\. Update Anki/),
    ).toBeInTheDocument();
  });

  it("Ignore stays app-only and can be reset", async () => {
    const setWordState = vi.fn();
    setup("/read/t-utrecht", (s) => ({
      ...s,
      setWordState: async (...a) => {
        setWordState(...a);
        return s.setWordState(...a);
      },
    }));
    await userEvent.click(await screen.findByText("grachten"));
    await userEvent.click(screen.getByRole("button", { name: "Ignore" }));
    expect(await screen.findByText("Word ignored")).toBeInTheDocument();
    expect(setWordState).toHaveBeenCalledWith("gracht", "ignored");
    expect(await screen.findByRole("button", { name: /Use Anki.s state/ })).toBeInTheDocument();
  });
});

describe("AppShell notices", () => {
  it("shows the storage notice and the demo chip with a way out", async () => {
    const onLeaveDemo = vi.fn();
    setup("/library", undefined, {
      notice: "Data will not be saved here.",
      demo: true,
      onLeaveDemo,
    });
    expect(await screen.findByText("Data will not be saved here.")).toBeInTheDocument();
    expect(screen.getByText("Demo data")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Use my data" }));
    expect(onLeaveDemo).toHaveBeenCalled();
  });

  it("shows no banner by default", async () => {
    setup("/library");
    await screen.findByText("Een dag in Utrecht");
    expect(screen.queryByText("Demo data")).toBeNull();
  });
});
