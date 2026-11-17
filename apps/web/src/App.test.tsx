import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "./App.js";
import { createMockServices } from "./services/mock.js";

function renderApp(path: string) {
  const history = createMemoryHistory({ initialEntries: [path] });
  return render(<App services={createMockServices({ latencyMs: 0 })} history={history} />);
}

describe("App with mock services", () => {
  it("redirects / to the library and lists texts", async () => {
    renderApp("/");
    expect(await screen.findByText("Een dag in Utrecht")).toBeInTheDocument();
    expect(screen.getByText("Op de markt")).toBeInTheDocument();
    // Anki has not been synced in the mock, so the onboarding hint shows.
    expect(await screen.findByRole("button", { name: "Connect Anki" })).toBeInTheDocument();
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
