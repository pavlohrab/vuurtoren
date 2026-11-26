import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App.js";
import { createMockServices } from "../services/mock.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function setup(url: string) {
  const sent: FormData[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (u: string, init?: RequestInit) => {
      if (String(u).endsWith("/v1/report")) sent.push(init!.body as FormData);
      return new Response(JSON.stringify({ ok: true, replies: [] }), { status: 200 });
    }),
  );
  const history = createMemoryHistory({ initialEntries: [url] });
  render(<App services={createMockServices({ latencyMs: 0 })} history={history} />);
  return { sent, user: userEvent.setup() };
}

describe("the feedback button (FB1)", () => {
  it("is not there without a key in the build", async () => {
    vi.stubEnv("VITE_FEEDBACK_KEY", "");
    setup("/settings?section=data");
    await screen.findByRole("heading", { name: /Data/ });
    expect(screen.queryByRole("button", { name: "Send feedback" })).toBeNull();
  });

  it("Settings → Send feedback opens the panel; Send goes to Pavlo after the Undo time", async () => {
    vi.stubEnv("VITE_FEEDBACK_KEY", "k");
    const { sent, user } = setup("/settings?section=data");
    const section = await screen.findByRole("region", { name: "Feedback" });
    await user.click(within(section).getByRole("button", { name: "Send feedback" }));
    const panel = await screen.findByRole("dialog", { name: /Feedback/ });
    await user.type(
      within(panel).getByRole("textbox", { name: "Write to Pavlo" }),
      "The plural says Verb.",
    );
    await user.click(within(panel).getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Sending…")).toBeVisible();
    await waitFor(() => expect(sent).toHaveLength(1), { timeout: 6000 });
    const report = JSON.parse(String(sent[0]!.get("report"))) as { text: string; screen: string };
    expect(report.text).toBe("The plural says Verb.");
    expect(report.screen).toContain("/settings");
  }, 10_000);

  it("says what's missing when there's nothing to send", async () => {
    vi.stubEnv("VITE_FEEDBACK_KEY", "k");
    const { user } = setup("/settings?section=data");
    const section = await screen.findByRole("region", { name: "Feedback" });
    await user.click(within(section).getByRole("button", { name: "Send feedback" }));
    const panel = await screen.findByRole("dialog", { name: /Feedback/ });
    await user.click(within(panel).getByRole("button", { name: "Send" }));
    expect(within(panel).getByRole("alert")).toHaveTextContent("Say what went wrong first.");
  });

  it("is one conversation: what was sent, then Pavlo's answer under it (FB2)", async () => {
    vi.stubEnv("VITE_FEEDBACK_KEY", "k");
    localStorage.clear();
    const { sent, user } = setup("/settings?section=data");
    const section = await screen.findByRole("region", { name: "Feedback" });
    await user.click(within(section).getByRole("button", { name: /Send feedback/ }));
    let panel = await screen.findByRole("dialog", { name: /Feedback/ });
    expect(within(panel).getByText(/He reads every message/)).toBeVisible();
    await user.type(
      within(panel).getByRole("textbox", { name: "Write to Pavlo" }),
      "Tour skips a step",
    );
    await user.click(within(panel).getByRole("button", { name: "Send" }));
    await waitFor(() => expect(sent).toHaveLength(1), { timeout: 6000 });
    const report = JSON.parse(String(sent[0]!.get("report"))) as { id: string; replyTo?: string };
    expect(report.replyTo).toMatch(/^d-/);
    localStorage.setItem(
      "vuurtoren.feedback.replies",
      JSON.stringify([{ report: report.id, text: "Looking at it today.", at: Date.now() + 1000 }]),
    );
    await waitFor(() => expect(screen.queryByText("Sending…")).toBeNull(), { timeout: 6000 });
    await user.click(within(section).getByRole("button", { name: /Send feedback/ }));
    panel = await screen.findByRole("dialog", { name: /Feedback/ });
    const log = within(panel).getByRole("log", { name: "Your messages with Pavlo" });
    expect(log).toHaveTextContent(/Tour skips a step.*Pavlo.*Looking at it today\./s);
  }, 15_000);
});
