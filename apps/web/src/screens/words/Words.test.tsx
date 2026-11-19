import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "../../App.js";
import { createMockServices } from "../../services/mock.js";
import type { AppServices } from "../../services/types.js";
import { parseSource } from "./Words.js";

function setup(url: string, patch: Partial<AppServices> = {}) {
  const services: AppServices = { ...createMockServices({ latencyMs: 0 }), ...patch };
  const history = createMemoryHistory({ initialEntries: [url] });
  render(<App services={services} history={history} />);
  return { services, history, user: userEvent.setup() };
}

describe("parseSource", () => {
  it("reads text, unit and practice-again sources", () => {
    expect(parseSource("text:t-1")).toEqual({ kind: "text", textId: "t-1" });
    expect(parseSource("unit:c-9/3")).toEqual({ kind: "unit", courseId: "c-9", unit: 3 });
    expect(parseSource("practice-again")).toEqual({ kind: "practice-again" });
    expect(parseSource("unit:x")).toBeNull();
    expect(parseSource(undefined)).toBeNull();
  });
});

describe("Words", () => {
  it("has a Due view in native mode only: words due now, earliest first, with how overdue", async () => {
    const native = { ...createMockServices({ latencyMs: 0, native: true }) };
    const history = createMemoryHistory({ initialEntries: ["/words?state=due"] });
    render(<App services={native} history={history} />);
    const due = await native.dueWords();
    expect(due.length).toBeGreaterThan(0);
    expect(await screen.findByRole("radio", { name: "Due" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    const table = await screen.findByRole("table");
    const rows = await within(table).findAllByRole("button", { name: /^Open / });
    expect(rows[0]).toHaveAccessibleName(`Open ${due[0]!.key}`);
    expect(screen.getAllByText(/^due (today|yesterday|\d+ days ago)$/).length).toBe(due.length);
  });

  it("has no Due view in connected mode", async () => {
    setup("/words");
    await screen.findByRole("radio", { name: "To decide" });
    expect(screen.queryByRole("radio", { name: "Due" })).toBeNull();
  });

  it("shows Claude's suggestions behind a chip: add one to Anki, dismiss another", async () => {
    const { services, user } = setup("/words");
    const chip = await screen.findByRole("button", { name: /Suggested \(2\)/ });
    await user.click(chip);
    const list = screen.getByRole("list", { name: "Suggested words" });
    expect(within(list).getByText("de reis")).toBeInTheDocument();
    expect(within(list).getByText(/journey/)).toBeInTheDocument();
    await user.click(within(list).getByRole("button", { name: "Dismiss de wind" }));
    await waitFor(() => expect(within(list).queryByText("de wind")).toBeNull());
    await user.click(await within(list).findByRole("button", { name: "Add to Anki: de reis" }));
    await waitFor(async () => expect(await services.suggestedWords()).toEqual([]));
    expect((await services.inspectWord("reis")).inAnki).toBe(true);
    await waitFor(() => expect(screen.queryByRole("button", { name: /Suggested \(/ })).toBeNull());
  });

  it("filters by state from the URL and shows a removable chip", async () => {
    const { history, user } = setup("/words?state=learning");
    const table = await screen.findByRole("table");
    await waitFor(() => expect(within(table).getAllByRole("row").length).toBeGreaterThan(1));
    for (const chip of within(table).getAllByText(/^Learning/)) expect(chip).toBeVisible();
    expect(within(table).queryByText("Known")).toBeNull();
    const chips = screen.getByRole("list", { name: "Active filters" });
    await user.click(
      within(chips).getByRole("button", { name: /Remove filter Showing: Learning/ }),
    );
    await waitFor(() => expect(history.location.search).not.toMatch(/state=/));
  });

  it("lists the words of a text and opens the shared inspector with its actions", async () => {
    const { history, user } = setup("/words?source=text:t-utrecht");
    expect(
      await screen.findByText(/From: Een dag in Utrecht/, undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Open gracht" }));
    await waitFor(() => expect(history.location.search).toMatch(/word=gracht/));
    const panel = screen.getByRole("complementary", { name: "Inspector" });
    expect(await within(panel).findByRole("button", { name: /Mark known/ })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Ignore" })).toBeInTheDocument();
    // No deck path on the word; Recall only for words being learned.
    expect(within(panel).queryByText(/Kenning::/)).toBeNull();
    expect(within(panel).queryByText(/Recall/)).toBeNull();
  });

  it("opens on the words to decide, without the optional columns", async () => {
    setup("/words");
    expect(await screen.findByRole("radio", { name: "To decide" })).toBeChecked();
    const table = await screen.findByRole("table");
    expect(within(table).queryByRole("columnheader", { name: "Recall" })).toBeNull();
    expect(within(table).queryByRole("columnheader", { name: "Decks" })).toBeNull();
    expect(await within(table).findByRole("button", { name: "Open vertrekken" })).toBeVisible();
    expect(within(table).queryByRole("button", { name: "Open boek" })).toBeNull();
  });

  it("opens a word outside any text by key", async () => {
    setup("/words?word=boek");
    const panel = await screen.findByRole("complementary", { name: "Inspector" });
    expect(await within(panel).findByText(/book/)).toBeInTheDocument();
  });

  it("sends a selection to Practice and Talk", async () => {
    const { user } = setup("/words?source=text:t-utrecht");
    // Checkboxes appear only in Select mode.
    await screen.findByRole("button", { name: "Open gracht" });
    expect(screen.queryByRole("checkbox", { name: "Select gracht" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Select" }));
    await user.click(await screen.findByRole("checkbox", { name: "Select gracht" }));
    const bar = screen.getByRole("region", { name: "Selected words" });
    expect(within(bar).getByText("1 selected")).toBeInTheDocument();
    expect(within(bar).getByRole("link", { name: /Practise these/ })).toHaveAttribute(
      "href",
      "/practice?words=gracht",
    );
    expect(within(bar).getByRole("link", { name: /Talk about these/ })).toHaveAttribute(
      "href",
      "/talk?words=gracht",
    );
  });
});
