import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "./App.js";
import { createMockServices } from "./services/mock.js";

function renderApp(path: string) {
  const history = createMemoryHistory({ initialEntries: [path] });
  return render(<App services={createMockServices({ latencyMs: 0 })} history={history} />);
}

describe("App with mock services", () => {
  it("opens Read at /, with Today and your texts; /library and /home lead there", async () => {
    renderApp("/library");
    expect(await screen.findByRole("heading", { level: 1, name: "Read" })).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: /^Goede/ })).toBeInTheDocument();
    await userEvent.click(
      within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", {
        name: /^Words/,
      }),
    );
    expect(await screen.findByRole("heading", { level: 1, name: "Your words" })).toBeVisible();
    await userEvent.click(
      within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Read" }),
    );
    expect(await screen.findByRole("heading", { level: 1, name: "Read" })).toBeInTheDocument();
    expect(
      (await screen.findAllByRole("link", { name: "Een dag in Utrecht" }))[0],
    ).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Op de markt" })[0]).toBeInTheDocument();
    // The mock's Anki is open and its decks are confirmed, so the app imports them by itself.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Connect Anki" })).toBeNull());
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
  });

  it("one Words entry: Review first with Vuurtoren's cards, the list with Anki", async () => {
    const history = createMemoryHistory({ initialEntries: ["/"] });
    const { unmount } = render(
      <App services={createMockServices({ latencyMs: 0, native: true })} history={history} />,
    );
    const nav = await screen.findByRole("navigation", { name: "Main" });
    await waitFor(() =>
      expect(within(nav).getByRole("link", { name: /^Words/ })).toHaveAttribute("href", "/review"),
    );
    expect(within(nav).getAllByRole("link", { name: /^Words/ })).toHaveLength(1);
    expect(within(nav).queryByRole("link", { name: /^(Review|Practice)/ })).toBeNull();
    unmount();
    renderApp("/");
    const connected = await screen.findByRole("navigation", { name: "Main" });
    expect(within(connected).getByRole("link", { name: /^Words/ })).toHaveAttribute(
      "href",
      "/words",
    );
  });

  it("opens a text and inspects a word", async () => {
    renderApp("/read/t-utrecht");
    const word = await screen.findByText("zus");
    await userEvent.click(word);
    expect(await screen.findByText("In review · due in 41 days")).toBeInTheDocument();
    expect(screen.getByText("sister")).toBeInTheDocument();
  });

  it("shows the words table", async () => {
    renderApp("/words");
    await waitFor(() => expect(screen.getByText("gracht")).toBeInTheDocument());
  });
});
