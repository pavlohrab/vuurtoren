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
  it("opens Home at /, and the library lists texts", async () => {
    renderApp("/");
    expect(await screen.findByRole("heading", { level: 1, name: /^Goede/ })).toBeInTheDocument();
    await userEvent.click(
      within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", {
        name: "Library",
      }),
    );
    expect(await screen.findByRole("heading", { level: 1, name: "Library" })).toBeInTheDocument();
    expect(
      (await screen.findAllByRole("button", { name: "Een dag in Utrecht" }))[0],
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Op de markt" })[0]).toBeInTheDocument();
    // The mock's Anki is open and its decks are confirmed, so the app imports them by itself.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Connect Anki" })).toBeNull());
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
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
