import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../services/context.js";
import { createMockAI } from "../services/mockAI.js";
import { createMockServices } from "../services/mock.js";
import { SentencePanel } from "./ReaderAI.js";

function renderExplain(configured: boolean) {
  const services = {
    ...createMockServices({ latencyMs: 0 }),
    ...createMockAI(() => Promise.resolve(), { configured }),
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ServicesProvider services={services}>
        <SentencePanel sentence="Ik bel je op." />
      </ServicesProvider>
    </QueryClientProvider>,
  );
}

describe("the Sentence tab", () => {
  it("explains the sentence, formatted, and answers follow-up questions", async () => {
    renderExplain(true);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Explain this sentence" }));
    expect(await screen.findByText(/mock explanation/)).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Ask about this sentence" }), "Why?");
    await user.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByText(/Answer 1/)).toBeInTheDocument();
    // Formatted: the answer's **keek** is bold, not stars.
    expect(screen.getByText("keek").tagName).toBe("STRONG");
    expect(screen.getByRole("textbox", { name: "Ask about this sentence" })).toHaveValue("");
  });
  it("says where to add a key when no provider is configured", async () => {
    renderExplain(false);
    expect(await screen.findByText(/Add your AI key/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Explain this sentence" })).toBeNull();
  });
});

describe("grammar in the Sentence tab (WC4)", () => {
  it("each topic can be focused and opened, also on a phone with no margin marks", async () => {
    const onFocusTopic = vi.fn();
    const services = {
      ...createMockServices({ latencyMs: 0 }),
      ...createMockAI(() => Promise.resolve(), { configured: false }),
    };
    const Panel = () => (
      <SentencePanel
        sentence="Ik bel je op."
        grammar={[{ id: "separable-verbs", title: "Separable verbs", note: "bel … op" }]}
        onFocusTopic={onFocusTopic}
      />
    );
    const router = createRouter({
      routeTree: createRootRoute({ component: Panel }),
      history: createMemoryHistory(),
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ServicesProvider services={services}>
          <RouterProvider router={router} />
        </ServicesProvider>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Focus on this" }));
    expect(onFocusTopic).toHaveBeenCalledWith("separable-verbs");
    expect(screen.getByRole("link", { name: "Open the topic" })).toHaveAttribute(
      "href",
      "/grammar/separable-verbs",
    );
  });
});
