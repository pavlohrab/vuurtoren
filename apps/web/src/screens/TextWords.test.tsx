import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "../App.js";
import { createMockServices } from "../services/mock.js";
import type { AppServices } from "../services/types.js";
import {
  actionOptions,
  applyActions,
  defaultAction,
  summarize,
  type RowResult,
} from "./textWordsActions.js";

function setup(path: string, wrap?: (s: AppServices) => AppServices) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const base = createMockServices({ latencyMs: 0 });
  const services = wrap ? wrap(base) : base;
  render(<App services={services} history={history} />);
  return { history, services };
}

const URL = "/read/t-utrecht/words";
const row = (lemma: string) => screen.getByRole("combobox", { name: `Action for ${lemma}` });

describe("textWordsActions", () => {
  it("starts each state with its own action and offers the rest", () => {
    expect(defaultAction("absent")).toBe("add");
    expect(defaultAction("new")).toBe("learn");
    expect(defaultAction("suspended")).toBe("learn");
    expect(defaultAction("learning")).toBe("skip");
    expect(defaultAction("review")).toBe("skip");
    expect(actionOptions("absent").map((o) => o.label)).toEqual([
      "Add to Anki",
      "Mark known",
      "Skip",
    ]);
    expect(actionOptions("suspended")[0]?.label).toBe("Unsuspend & study first");
    expect(actionOptions("review").map((o) => o.label)).toEqual(["Skip", "Mark known"]);
  });

  it("summarises quietly", () => {
    const ok = (kind: "added" | "moved" | "known", deck?: string): RowResult => ({
      ok: true,
      kind,
      message: "",
      ...(deck ? { deck } : {}),
    });
    const added = Array.from({ length: 5 }, () => ok("added", "Kenning::Nederlands"));
    const moved = [ok("moved", "A"), ok("moved", "B")];
    expect(summarize([...added, ...moved])).toBe(
      "5 added to Kenning::Nederlands, 2 moved to the front of their decks.",
    );
    expect(summarize([ok("moved"), { ok: false, message: "x" }])).toBe(
      "1 moved to the front of its deck. 1 word could not be updated.",
    );
    expect(summarize([])).toBe("Nothing was changed.");
  });

  it("goes on after a failure and runs the jobs one at a time", async () => {
    const mock = createMockServices({ latencyMs: 0 });
    const reading = (await mock.getReading("t-utrecht"))!;
    expect(reading).toBeTruthy();
    const items = await mock.textWords("t-utrecht");
    const order: string[] = [];
    let running = 0;
    const services = {
      addToAnki: async () => {
        order.push("add");
        running += 1;
        expect(running).toBe(1);
        await Promise.resolve();
        running -= 1;
        throw new Error("Deck is locked");
      },
      learnNext: async () => {
        order.push("learn");
        return { deck: "D" };
      },
      markKnown: async () => ({}),
    };
    const jobs = [
      { item: items[0]!, action: "add" as const },
      { item: items[1]!, action: "learn" as const },
    ];
    const results = await applyActions(jobs, services);
    expect(order).toEqual(["add", "learn"]);
    expect(results.get(items[0]!.key)).toEqual({ ok: false, message: "Deck is locked" });
    expect(results.get(items[1]!.key)?.ok).toBe(true);
  });
});

describe("TextWords page", () => {
  it("starts every row with the action for its state in Anki", async () => {
    setup(URL);
    expect(await screen.findByRole("heading", { name: "Words from this text" })).toBeVisible();
    await screen.findByText("vertrekken");
    expect(row("vertrekken")).toHaveTextContent("Add to Anki");
    expect(row("meenemen")).toHaveTextContent("Study first in Anki");
    expect(row("reis")).toHaveTextContent("Unsuspend & study first");
    expect(row("opbellen")).toHaveTextContent("Skip");
    expect(row("trein")).toHaveTextContent("Skip");
    // article for nouns, meaning and the sentence with the word marked
    expect(screen.getByText("journey")).toBeVisible();
    const reis = screen.getByText("reis", { selector: ".tw-word" });
    expect(reis.textContent).toBe("de reis");
    expect(screen.getByText("reis", { selector: "mark" })).toBeVisible();
    // known and nonwords are not listed; the count is on the button
    expect(screen.queryByText("zus")).toBeNull();
    expect(screen.getByRole("button", { name: "Apply 3 actions" })).toBeEnabled();
  });

  it("disables actions of a word when Anki cannot be reached, and says why", async () => {
    setup(URL);
    await screen.findByText("vertrekken");
    expect(row("boek")).toBeDisabled();
    expect(screen.getByText(/Actions are unavailable: cannot reach/)).toBeVisible();
    expect(screen.getByText("Anki not reachable", { selector: ".k-chip" })).toBeVisible();
  });

  it("changes the count when an action is chosen", async () => {
    setup(URL);
    await screen.findByText("vertrekken");
    await userEvent.click(row("opbellen"));
    await userEvent.click(await screen.findByRole("option", { name: "Mark known" }));
    expect(screen.getByRole("button", { name: "Apply 4 actions" })).toBeVisible();
    await userEvent.click(row("vertrekken"));
    await userEvent.click(await screen.findByRole("option", { name: "Skip" }));
    expect(screen.getByRole("button", { name: "Apply 3 actions" })).toBeVisible();
  });

  it("applies the actions, reports the failure and summarises", async () => {
    const calls: string[] = [];
    let failLearn = true;
    setup(URL, (s) => ({
      ...s,
      addToAnki: async (e) => {
        calls.push(`add:${e.key}`);
        return s.addToAnki(e);
      },
      learnNext: async (e) => {
        calls.push(`learn:${e.key}`);
        if (e.key === "meenemen" && failLearn) throw new Error("Its card is no longer new in Anki");
        return s.learnNext(e);
      },
    }));
    await screen.findByText("vertrekken");
    await userEvent.click(screen.getByRole("button", { name: "Apply 3 actions" }));

    expect(await screen.findByText(/1 added to Kenning::Nederlands::Reading/)).toBeVisible();
    expect(screen.getByText(/1 moved to the front of its deck/)).toBeVisible();
    expect(screen.getByText(/1 word could not be updated/)).toBeVisible();
    expect(calls).toEqual(["add:vertrekken", "learn:meenemen", "learn:reis"]);
    expect(screen.getByText("Failed. Its card is no longer new in Anki")).toBeVisible();
    expect(screen.getByText("Done. Added to Kenning::Nederlands::Reading")).toBeVisible();
    // finished rows are locked; only the failed one is left to retry
    expect(row("vertrekken")).toBeDisabled();
    expect(row("meenemen")).toBeEnabled();
    const apply = screen.getByRole("button", { name: "Apply 1 action" });

    // Re-applying is safe: done rows are not sent again.
    failLearn = false;
    await userEvent.click(apply);
    await waitFor(() =>
      expect(screen.getByText(/^1 moved to the front of its deck\.$/)).toBeVisible(),
    );
    expect(calls).toEqual(["add:vertrekken", "learn:meenemen", "learn:reis", "learn:meenemen"]);
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  it("disables Apply while running and shows progress", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    setup(URL, (s) => ({
      ...s,
      addToAnki: async (e) => {
        await gate;
        return s.addToAnki(e);
      },
    }));
    await screen.findByText("vertrekken");
    await userEvent.click(screen.getByRole("button", { name: "Apply 3 actions" }));
    expect(await screen.findByText("Applying 1 of 3: vertrekken")).toBeVisible();
    expect(screen.getByRole("button", { name: /Applying/ })).toBeDisabled();
    release();
    expect(await screen.findByText(/1 added to/)).toBeVisible();
  });

  it("shows translated-only words when asked", async () => {
    setup(URL);
    await screen.findByText("vertrekken");
    expect(screen.queryByText("langskomen")).toBeNull();
    await userEvent.click(screen.getByLabelText("Show translated words too"));
    // grachten is translated only (a gloss), so it appears with the toggle
    expect(await screen.findByText("gracht", { selector: ".tw-word" })).toBeVisible();
  });

  it("shows a quiet empty state", async () => {
    setup(URL, (s) => ({ ...s, textWords: async () => [] }));
    expect(await screen.findByText("No new words in this text")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Apply/ })).toBeNull();
  });

  it("shows the real error with a retry when the words cannot be loaded", async () => {
    let fail = true;
    setup(URL, (s) => ({
      ...s,
      textWords: async (...a) => {
        if (fail) throw new Error("The database is locked");
        return s.textWords(...a);
      },
    }));
    expect(await screen.findByText(/The database is locked/)).toBeVisible();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("vertrekken")).toBeVisible();
  });
});

describe("routing to the review", () => {
  it("finishing the last segment shows the completion panel, which leads on to the review", async () => {
    const { history } = setup("/read/t-utrecht");
    await userEvent.click(await screen.findByRole("button", { name: "Next segment" }));
    await userEvent.click(await screen.findByRole("button", { name: "Finish text" }));
    const done = await screen.findByRole("region", { name: "Een dag in Utrecht" });
    expect(within(done).getByText("Finished")).toBeInTheDocument();
    expect(await within(done).findByText("New words met")).toBeInTheDocument();
    const next = within(done).getByRole("navigation", { name: "Next steps" });
    expect(within(next).getByRole("link", { name: /Practise these words/ })).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/practice\?words=/),
    );
    expect(within(next).getByRole("link", { name: /Talk about this text/ })).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/talk\?.*topic=/),
    );
    expect(within(next).getByRole("link", { name: /Next text/ })).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/read\/t-/),
    );
    await userEvent.click(within(next).getByRole("link", { name: /Words from this text/ }));
    expect(await screen.findByRole("heading", { name: "Words from this text" })).toBeVisible();
    expect(history.location.pathname).toBe(URL);
  });

  it("is reachable from the reader footer and from the library card", async () => {
    const { history } = setup("/read/t-markt");
    await userEvent.click(await screen.findByRole("link", { name: "Words from this text" }));
    await screen.findByRole("heading", { name: "Words from this text" });
    expect(history.location.pathname).toBe("/read/t-markt/words");

    history.push("/library");
    await userEvent.click(
      (await screen.findAllByRole("button", { name: "More for Het weer" }))[0]!,
    );
    await userEvent.click(await screen.findByRole("menuitem", { name: "Words from this text" }));
    await screen.findByRole("heading", { name: "Words from this text" });
    expect(history.location.pathname).toBe("/read/t-weer/words");
  });
});
