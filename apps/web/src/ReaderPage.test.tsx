import { createMemoryHistory } from "@tanstack/react-router";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App, type AppProps } from "./App.js";
import { createMockServices } from "./services/mock.js";
import type { AppServices } from "./services/types.js";

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

describe("ReaderPage", () => {
  it("starts a different text from its own beginning, with no selection", async () => {
    const { history } = setup("/read/t-utrecht");
    await userEvent.click(await screen.findByRole("button", { name: "Next segment" }));
    expect(await screen.findByText("Segment 2 of 2")).toBeInTheDocument();
    await userEvent.click(await screen.findByText("trein"));
    await act(async () => history.push("/read/t-markt"));
    expect(await screen.findByText("Segment 1 of 2")).toBeInTheDocument();
    expect(screen.getByText(/Select a word in the text/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add to Anki" })).toBeNull();
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
    expect(await screen.findByText("Segment 1 of 2")).toBeInTheDocument();
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
    await userEvent.click(await screen.findByRole("button", { name: "Next segment" }));
    await userEvent.click(await screen.findByRole("button", { name: "Previous" }));
    expect(await screen.findByText("Segment 1 of 2")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next segment" }));
    expect(await screen.findByText("Segment 2 of 2")).toBeInTheDocument();
    expect(finish).toHaveBeenCalledTimes(1);
    expect(finish.mock.calls[0]?.[1]).toBe(0);

    // Leaving and coming back resumes at the segment after the finished one.
    await act(async () => history.push("/library"));
    await screen.findByText("Op de markt");
    await act(async () => history.push("/read/t-utrecht"));
    expect(await screen.findByText("Segment 2 of 2")).toBeInTheDocument();
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
    await userEvent.click(await screen.findByRole("button", { name: "Show answers" }));
    await userEvent.click(screen.getByRole("button", { name: "Next segment" }));
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
    await userEvent.click(await screen.findByRole("button", { name: "Next segment" }));
    expect(await screen.findByText("Disk is full")).toBeInTheDocument();
    expect(screen.getByText("Segment 1 of 2")).toBeInTheDocument();
  });

  it("leaves arrow keys to focused buttons", async () => {
    setup("/read/t-utrecht");
    const next = await screen.findByRole("button", { name: "Next segment" });
    next.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(next).toHaveFocus();
  });
});

describe("Anki write actions in the inspector", () => {
  const buttons = () => screen.getAllByRole("button").map((b) => b.textContent);
  const inspectorButtons = (...names: string[]) =>
    names.forEach((n) => expect(screen.getByRole("button", { name: n })).toBeInTheDocument());

  async function openSecondSegment() {
    await userEvent.click(await screen.findByRole("button", { name: "Next segment" }));
    await screen.findByText("Segment 2 of 2");
  }

  it("absent word: Mark known adds it as known, then offers Use Anki's state", async () => {
    setup("/read/t-utrecht");
    await userEvent.click(await screen.findByText("grachten"));
    inspectorButtons("Add to Anki", "Mark known", "Ignore");
    expect(screen.getByText("Adds it to Anki as known")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Mark known" }));
    expect(await screen.findByText("Added to Kenning::Reading as known")).toBeInTheDocument();
    expect(await screen.findByText("In review · due in 28 days")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark known" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Use Anki.s state/ }));
    expect(await screen.findByText(/Using Anki.s state/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Use Anki.s state/ })).toBeNull(),
    );
  });

  it("absent word: Add to Anki toasts the deck", async () => {
    setup("/read/t-utrecht");
    await userEvent.click(await screen.findByText("grachten"));
    await userEvent.click(screen.getByRole("button", { name: "Add to Anki" }));
    expect(await screen.findByText("Added to Kenning::Reading")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Learn next" })).toBeInTheDocument();
  });

  it("new card: Learn next moves it and says where", async () => {
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
    expect(
      await screen.findByText(
        "Moves its card to the front of \u2018A Frequency Dictionary of Dutch\u2019",
      ),
    ).toBeInTheDocument();
    expect(buttons()).toContain("Learn next");
    await userEvent.click(screen.getByRole("button", { name: "Learn next" }));
    expect(
      await screen.findByText("Moved to the front of \u2018A Frequency Dictionary of Dutch\u2019"),
    ).toBeInTheDocument();
    expect(learn).toHaveBeenCalledWith("new");
    expect(
      await screen.findByText("New card · next in A Frequency Dictionary of Dutch"),
    ).toBeInTheDocument();
  });

  it("suspended card: Unsuspend & learn next", async () => {
    setup("/read/t-utrecht");
    await openSecondSegment();
    await userEvent.click(await screen.findByText("reis"));
    inspectorButtons("Unsuspend & learn next", "Mark known");
    expect(screen.getByText("Suspended")).toBeInTheDocument();
  });

  it("in progress: status line, Mark known marks it", async () => {
    setup("/read/t-utrecht");
    await openSecondSegment();
    await userEvent.click(await screen.findByText("trein"));
    expect(await screen.findByText("In review · due in 6 days")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Mark known" }));
    expect(await screen.findByText("Marked as known in Anki")).toBeInTheDocument();
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

  it("shows the real error when Learn next fails", async () => {
    setup("/read/t-utrecht", (s) => ({
      ...s,
      learnNext: async () => {
        throw new Error("Learn next needs AnkiConnect with API v1 (Anki ≥ 26.08)");
      },
    }));
    await openSecondSegment();
    await userEvent.click(await screen.findByText("neemt"));
    await userEvent.click(await screen.findByRole("button", { name: "Learn next" }));
    expect(
      await screen.findByText("Learn next needs AnkiConnect with API v1 (Anki ≥ 26.08)"),
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
