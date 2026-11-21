import { createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

describe("Write a story", () => {
  it("writes a story from Add text, opens it in the reader, and marks it as an AI story", async () => {
    const { services, history, user } = setup("/import");
    await user.click(await screen.findByRole("tab", { name: "Write a story" }));
    const dialog = await screen.findByRole("main");
    expect(within(dialog).getByText(/tokens in/)).toBeInTheDocument();
    // The AI chooses the topic unless the learner gives one.
    await user.click(within(dialog).getByRole("button", { name: "My topic" }));
    await user.type(within(dialog).getByLabelText("Topic"), "de markt");
    await user.click(within(dialog).getByRole("button", { name: /Long/ }));
    await user.click(within(dialog).getByRole("button", { name: "Dialogue" }));
    // Two linked sliders: learning and new words stay under 50% together.
    const learning = within(dialog).getByRole("slider", { name: /Learning words/ });
    const fresh = within(dialog).getByRole("slider", { name: /New words/ });
    fireEvent.change(fresh, { target: { value: "20" } });
    fireEvent.change(learning, { target: { value: "40" } });
    expect(fresh).toHaveValue("10");
    expect(within(dialog).getByRole("img", { name: /50% known words/ })).toBeInTheDocument();
    // The learning words it uses are shown, not edited.
    expect(await within(dialog).findByText(/Learning words it uses: gezellig/)).toBeVisible();
    await user.type(within(dialog).getByLabelText(/Anything else for the AI/), "Maak het grappig");
    await user.click(within(dialog).getByRole("button", { name: "Write the story" }));
    await waitFor(() => expect(history.location.pathname).toMatch(/^\/read\//));
    expect(services.createStory).toHaveBeenCalledWith(
      {
        topic: "de markt",
        length: "long",
        style: "dialogue",
        targetWords: ["gezellig", "kraam", "afspraak"],
        mix: { learning: 0.4, fresh: 0.1 },
        notes: "Maak het grappig",
      },
      expect.any(Function),
    );
    expect(await screen.findByText(/does not use: afspraak/)).toBeInTheDocument();

    await history.push("/library");
    await waitFor(() => {
      const card = screen
        .getAllByRole("listitem")
        .find((a) => within(a).queryByText(MOCK_STORY.title));
      expect(card && within(card).getByText("AI story")).toBeInTheDocument();
    });
  });

  it("features a grammar topic from its page", async () => {
    const { services, user } = setup("/grammar/inversion");
    await user.click(await screen.findByRole("link", { name: /Write a story/ }));
    const dialog = await screen.findByRole("main");
    expect(await within(dialog).findByRole("button", { name: "A grammar topic" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(within(dialog).getByRole("button", { name: "Write the story" }));
    await waitFor(() => expect(services.createStory).toHaveBeenCalled());
    expect(vi.mocked(services.createStory).mock.calls[0]![0]).toMatchObject({
      grammarTopic: "inversion",
      topic: "",
    });
  });

  it("is hidden when no AI provider is configured", async () => {
    setup("/grammar/inversion", {
      aiStatus: async () => ({
        configured: false,
        locked: false,
        keySaved: false,
        encrypted: false,
        needsKey: true,
        label: "Anthropic",
      }),
    });
    await screen.findAllByRole("heading");
    // the status query has settled by now
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("link", { name: /Write a story/ })).not.toBeInTheDocument();
  });
});
