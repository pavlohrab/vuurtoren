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
  it("shows Claude's suggestions behind a chip: add one to Anki, dismiss another", async () => {
    const { services, user } = setup("/words");
    const chip = await screen.findByRole("button", { name: /Suggested by Claude \(2\)/ });
    await user.click(chip);
    const list = screen.getByRole("list", { name: "Suggested by Claude" });
    expect(within(list).getByText("de reis")).toBeInTheDocument();
    expect(within(list).getByText(/journey/)).toBeInTheDocument();
    await user.click(within(list).getByRole("button", { name: "Dismiss de wind" }));
    await waitFor(() => expect(within(list).queryByText("de wind")).toBeNull());
    await user.click(await within(list).findByRole("button", { name: /^Add de reis to/ }));
    await waitFor(async () => expect(await services.suggestedWords()).toEqual([]));
    expect((await services.inspectWord("reis")).inAnki).toBe(true);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Suggested by Claude/ })).toBeNull(),
    );
  });

  it("filters by state from the URL and shows a removable chip", async () => {
    const { history, user } = setup("/words?state=learning");
    const table = await screen.findByRole("table");
    await waitFor(() => expect(within(table).getAllByRole("row").length).toBeGreaterThan(1));
    for (const chip of within(table).getAllByText(/^Learning/)) expect(chip).toBeVisible();
    expect(within(table).queryByText("Known")).toBeNull();
    const chips = screen.getByRole("list", { name: "Active filters" });
    await user.click(within(chips).getByRole("button", { name: /Remove filter State: Learning/ }));
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
    expect(within(panel).getByText(/Kenning::/)).toBeInTheDocument();
  });

  it("opens a word outside any text by key", async () => {
    setup("/words?word=boek");
    const panel = await screen.findByRole("complementary", { name: "Inspector" });
    expect(await within(panel).findByText(/book/)).toBeInTheDocument();
  });

  it("sends a selection to Practice and Talk", async () => {
    const { user } = setup("/words?source=text:t-utrecht");
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
