import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "../App.js";
import { createMockAI, MOCK_NEW_WORD } from "../services/mockAI.js";
import { createMockServices } from "../services/mock.js";
import type { AppServices } from "../services/types.js";

/** A message bubble by its whole text (its words are separate, clickable spans). */
const bubble = (text: string) =>
  screen.findByText(
    (_, el) => el?.classList.contains("cv-bubble") === true && el.textContent === text,
  );

function setup(path: string, configured = true, patch: Partial<AppServices> = {}) {
  const ai = createMockAI(() => Promise.resolve(), { configured });
  const services: AppServices = { ...createMockServices({ latencyMs: 0 }), ...ai, ...patch };
  const history = createMemoryHistory({ initialEntries: [path] });
  render(<App services={services} history={history} />);
  return { ai, user: userEvent.setup() };
}

describe("Converse", () => {
  it("asks for a provider when none is configured", async () => {
    setup("/converse", false);
    expect(await screen.findByText(/Add an AI provider/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "AI →" })).toBeInTheDocument();
  });

  it("starts a chat, shows coverage, adds a new word to Anki and shows corrections", async () => {
    const { ai, user } = setup("/converse");
    await user.click(await screen.findByText("Your own topic"));
    await user.type(await screen.findByLabelText("Topic"), "koffie");
    // Suggested target words are prefilled.
    expect(screen.getByLabelText("Words to practise")).toHaveValue("gezellig, afspraak");
    await user.click(screen.getByRole("button", { name: "Start conversation" }));

    const hoi = await bubble("Hoi! Drink je graag koffie?");
    expect(screen.getByText("98% known")).toBeInTheDocument();
    // Every word opens the inspector, as in the reader.
    await user.click(within(hoi).getByRole("button", { name: "koffie" }));
    const panel = await screen.findByRole("complementary", { name: "Inspector" });
    // The word with its sentence from the message as the context.
    await waitFor(() => expect(panel).toHaveTextContent(/Drink je graag koffie\?/));

    await user.click(await screen.findByRole("button", { name: "Add to Anki: gezellig" }));
    await waitFor(() => expect(ai.added).toEqual([MOCK_NEW_WORD]));
    expect(screen.getByRole("button", { name: "Add gezellig to Anki" })).toBeDisabled();

    await user.type(screen.getByLabelText("Your message"), "Ik is blij");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await bubble("Wat leuk. Waar drink je koffie?")).toBeInTheDocument();
    // inline correction of the learner's message
    expect(screen.getByText("ik is")).toBeInTheDocument();
    expect(screen.getByText("ik ben")).toBeInTheDocument();
    // a rewritten reply says so and shows the gloss of what is left
    expect(screen.getByText(/Simplified once/)).toBeInTheDocument();
    expect(screen.getByText("coffee shop", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("93% known")).toBeInTheDocument();
  });
});

describe("Talk entry points and the Library", () => {
  it("offers suggested starts and starts one in a click", async () => {
    const started: unknown[] = [];
    const base = createMockAI(() => Promise.resolve(), { configured: true });
    const { user } = setup("/talk", true, {
      startConversation: async (input) => {
        started.push(input);
        return base.startConversation(input);
      },
    });
    const list = await screen.findByRole("list", { name: "Ways to start" });
    expect(list).toHaveTextContent("Everyday life");
    await user.click(await screen.findByRole("button", { name: /Your words to learn/ }));
    await waitFor(() => expect(started).toHaveLength(1));
    expect(started[0]).toMatchObject({ targetWords: ["gezellig", "afspraak"] });
  });

  it("is seeded with words and a topic from the URL, titles the topic in sentence case and saves the chat to the Library", async () => {
    const imported: unknown[] = [];
    const { user } = setup("/talk?words=gracht,brug&topic=een%20dag%20in%20utrecht", true, {
      importText: async (input) => {
        imported.push(input);
        return "t-saved";
      },
    });
    expect(await screen.findByLabelText("Topic")).toHaveValue("een dag in utrecht");
    expect(screen.getByLabelText("Words to practise")).toHaveValue("gracht, brug");
    await user.click(screen.getByRole("button", { name: "Start conversation" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Een dag in utrecht" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Save to my texts/ }));
    await waitFor(() => expect(imported).toHaveLength(1));
    expect(imported[0]).toMatchObject({
      kind: "talk",
      title: "Talk: Een dag in utrecht",
      ref: expect.stringMatching(/^talk:/),
      content: expect.stringMatching(/^— /),
    });
    expect(await screen.findByRole("button", { name: "Read it now" })).toBeInTheDocument();
  });
});

describe("AI settings and reader helpers", () => {
  it("saves a key and tests the connection", async () => {
    const { user } = setup("/settings?section=ai", false);
    await user.type(await screen.findByLabelText("API key"), "sk-test");
    await user.click(screen.getByRole("button", { name: "Test" }));
    expect(await screen.findByText(/Works: the model answered/)).toBeInTheDocument();
  });

  it("offers Simplify this page only with a provider, and keeps the original", async () => {
    const off = setup("/read/t-utrecht", false);
    await screen.findByRole("button", { name: "Next" });
    await userEvent.click(screen.getByRole("button", { name: "More reading options" }));
    await screen.findByRole("menu", { name: "More reading options" });
    expect(screen.queryByRole("menuitem", { name: "Simplify this page" })).toBeNull();
    void off;
  });

  it("shows the simplified page beside the original", async () => {
    const { user } = setup("/read/t-utrecht");
    await user.click(await screen.findByRole("button", { name: "More reading options" }));
    await user.click(await screen.findByRole("menuitem", { name: "Simplify this page" }));
    const region = await screen.findByRole("region", { name: "Simplified page" });
    expect(region).toHaveTextContent("The original text is unchanged");
    expect(region).toHaveTextContent("88.0%");
    expect(region).toHaveTextContent("97.0%");
  });
});
