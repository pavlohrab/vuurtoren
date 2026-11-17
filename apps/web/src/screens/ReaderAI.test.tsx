import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ServicesProvider } from "../services/context.js";
import { createMockAI } from "../services/mockAI.js";
import { createMockServices } from "../services/mock.js";
import { ExplainSentence } from "./ReaderAI.js";

function renderExplain(configured: boolean) {
  const services = {
    ...createMockServices({ latencyMs: 0 }),
    ...createMockAI(() => Promise.resolve(), { configured }),
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ServicesProvider services={services}>
        <ExplainSentence sentence="Ik bel je op." />
      </ServicesProvider>
    </QueryClientProvider>,
  );
}

describe("ExplainSentence", () => {
  it("explains the sentence on request", async () => {
    renderExplain(true);
    await userEvent.click(await screen.findByRole("button", { name: "Explain this sentence" }));
    expect(await screen.findByText(/mock explanation/)).toBeInTheDocument();
  });
  it("is hidden when no provider is configured", async () => {
    renderExplain(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("button", { name: "Explain this sentence" })).toBeNull();
  });
});
