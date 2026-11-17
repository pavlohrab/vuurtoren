import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "../App.js";
import { createMockAI, MOCK_NEW_WORD } from "../services/mockAI.js";
import { createMockServices } from "../services/mock.js";
import type { AppServices } from "../services/types.js";

function setup(path: string, configured = true) {
  const ai = createMockAI(() => Promise.resolve(), { configured });
  const services: AppServices = { ...createMockServices({ latencyMs: 0 }), ...ai };
  const history = createMemoryHistory({ initialEntries: [path] });
  render(<App services={services} history={history} />);
  return { ai, user: userEvent.setup() };
}

describe("Converse", () => {
  it("asks for a provider when none is configured", async () => {
    setup("/converse", false);
    expect(await screen.findByText(/Add an AI provider/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Settings" })).toBeInTheDocument();
  });

  it("starts a chat, shows coverage, adds a new word to Anki and shows corrections", async () => {
    const { ai, user } = setup("/converse");
    await user.type(await screen.findByLabelText("Topic"), "koffie");
    // Suggested target words are prefilled.
    expect(screen.getByLabelText("Words to practise")).toHaveValue("gezellig, afspraak");
    await user.click(screen.getByRole("button", { name: "Start conversation" }));

    expect(await screen.findByText("Hoi! Drink je graag koffie?")).toBeInTheDocument();
    expect(screen.getByText("98% known")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add gezellig to Anki" }));
    await waitFor(() => expect(ai.added).toEqual([MOCK_NEW_WORD]));
    expect(screen.getByRole("button", { name: "Add gezellig to Anki" })).toBeDisabled();

    await user.type(screen.getByLabelText("Your message"), "Ik is blij");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Wat leuk. Waar drink je koffie?")).toBeInTheDocument();
    // inline correction of the learner's message
    expect(screen.getByText("ik is")).toBeInTheDocument();
    expect(screen.getByText("ik ben")).toBeInTheDocument();
    // a rewritten reply says so and shows the gloss of what is left
    expect(screen.getByText(/Simplified once/)).toBeInTheDocument();
    expect(screen.getByText("coffee shop", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("93% known")).toBeInTheDocument();
  });
});

describe("AI settings and reader helpers", () => {
  it("saves a key and tests the connection", async () => {
    const { user } = setup("/settings", false);
    await user.type(await screen.findByLabelText("API key"), "sk-test");
    await user.click(screen.getByRole("button", { name: "Test" }));
    expect(await screen.findByText(/Works: the model answered/)).toBeInTheDocument();
  });

  it("offers Simplify this page only with a provider, and keeps the original", async () => {
    const off = setup("/read/t-utrecht", false);
    await screen.findByRole("button", { name: "Next segment" });
    expect(screen.queryByRole("button", { name: "Simplify this page" })).toBeNull();
    void off;
  });

  it("shows the simplified page beside the original", async () => {
    const { user } = setup("/read/t-utrecht");
    await user.click(await screen.findByRole("button", { name: "Simplify this page" }));
    const region = await screen.findByRole("region", { name: "Simplified page" });
    expect(region).toHaveTextContent("The original text is unchanged");
    expect(region).toHaveTextContent("88.0%");
    expect(region).toHaveTextContent("97.0%");
  });
});
