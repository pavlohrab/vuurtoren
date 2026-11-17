import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App.js";
import { MOCK_STORY } from "../services/mockAI.js";
import { createMockServices } from "../services/mock.js";
import type { AppServices } from "../services/types.js";

function setup(path = "/", patch: Partial<AppServices> = {}) {
  const base = createMockServices({ latencyMs: 0 });
  const services: AppServices = { ...base, createStory: vi.fn(base.createStory), ...patch };
  const history = createMemoryHistory({ initialEntries: [path] });
  render(<App services={services} history={history} />);
  return { services, history, user: userEvent.setup() };
}

describe("Create a story", () => {
  it("creates a story from the Library, opens it in the reader, and marks it as an AI story", async () => {
    const { services, history, user } = setup("/library");
    await user.click(await screen.findByRole("button", { name: /Create a story/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/tokens in/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Topic"), "de markt");
    await user.click(within(dialog).getByRole("button", { name: /Medium/ }));
    await user.click(within(dialog).getByRole("button", { name: "Dialogue" }));
    // "Words to learn now" are suggested and editable
    const words = within(dialog).getByLabelText("Words to use");
    await waitFor(() => expect(words).toHaveValue("gezellig, kraam, afspraak"));
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(history.location.pathname).toMatch(/^\/read\//));
    expect(services.createStory).toHaveBeenCalledWith(
      {
        topic: "de markt",
        length: "medium",
        style: "dialogue",
        targetWords: ["gezellig", "kraam", "afspraak"],
      },
      expect.any(Function),
    );
    expect(await screen.findByText(/does not use: afspraak/)).toBeInTheDocument();

    await history.push("/library");
    await waitFor(() => {
      const card = screen
        .getAllByRole("article")
        .find((a) => within(a).queryByText(MOCK_STORY.title));
      expect(card && within(card).getByText("AI story")).toBeInTheDocument();
    });
  });

  it("features a grammar topic from its page", async () => {
    const { services, user } = setup("/grammar/inversion");
    await user.click(await screen.findByRole("button", { name: /Create a story/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "A grammar topic" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(services.createStory).toHaveBeenCalled());
    expect(vi.mocked(services.createStory).mock.calls[0]![0]).toMatchObject({
      grammarTopic: "inversion",
      targetWords: [],
    });
  });

  it("is hidden when no AI provider is configured", async () => {
    setup("/library", {
      aiStatus: async () => ({
        configured: false,
        locked: false,
        keySaved: false,
        encrypted: false,
        needsKey: true,
        label: "Anthropic",
      }),
    });
    await screen.findAllByRole("article");
    // the status query has settled once the Library's cards are shown
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("button", { name: /Create a story/ })).not.toBeInTheDocument();
  });
});
