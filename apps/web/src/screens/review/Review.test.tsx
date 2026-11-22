import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../../App.js";
import { createMockServices } from "../../services/mock.js";
import type { AppServices } from "../../services/types.js";
import { sanitizeCardHtml } from "./sanitize.js";

function setup(path = "/review", patch: Partial<AppServices> = {}) {
  const base = createMockServices({ latencyMs: 0, synced: true, native: true });
  const services: AppServices = { ...base, ...patch };
  const history = createMemoryHistory({ initialEntries: [path] });
  render(<App services={services} history={history} />);
  return { services, history, user: userEvent.setup() };
}

describe("Review", () => {
  it("says the word as the front shows, the sentence on request, and R replays", async () => {
    const audioClip = vi.fn<(id: string) => Promise<Blob | null>>(async () => null);
    const { user } = setup("/review", { audioClip });
    await screen.findByText("de fiets");
    // Autoplay of the word is on by default; the sentence waits for a click (its autoplay is off).
    await waitFor(() => expect(audioClip).toHaveBeenCalledWith("word-demo1"));
    await user.keyboard(" ");
    await screen.findByText("bicycle");
    expect(audioClip).not.toHaveBeenCalledWith("sentence-demo1");
    await user.click(screen.getByRole("button", { name: "Play the sentence" }));
    await waitFor(() => expect(audioClip).toHaveBeenCalledWith("sentence-demo1"));
    audioClip.mockClear();
    await user.keyboard("r");
    await waitFor(() => expect(audioClip).toHaveBeenCalledWith("word-demo1"));
    expect(screen.getByRole("button", { name: "Play the word (R)" })).toBeVisible();
  });

  it("comes again when a card becomes due while the screen is open, and on returning to the app", async () => {
    const base = createMockServices({ latencyMs: 0, synced: true, native: true });
    const full = await base.reviewQueue();
    let calls = 0;
    const reviewQueue = vi.fn(async () => {
      calls++;
      // First nothing yet, with a learning step due in a moment; then the card is there.
      if (calls === 1) return { cards: [], due: 0, fresh: 0, nextDue: Date.now() + 100 };
      return full;
    });
    setup("/review", { reviewQueue });
    expect(await screen.findByRole("heading", { name: "Nothing due" })).toBeVisible();
    expect(await screen.findByText("de fiets", {}, { timeout: 4000 })).toBeVisible();
    // Back in the foreground: the queue is asked again, the card on screen stays.
    const before = reviewQueue.mock.calls.length;
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(reviewQueue.mock.calls.length).toBeGreaterThan(before));
    expect(screen.getByText("de fiets")).toBeVisible();
  });

  it("after the day's cards, goes on with new words or learning words on request", async () => {
    const reviewQueue = vi.fn(async () => ({ cards: [], due: 0, fresh: 0, nextDue: null }));
    const { user } = setup("/review", { reviewQueue });
    expect(await screen.findByRole("heading", { name: "Nothing due" })).toBeVisible();
    await user.click(screen.getByRole("link", { name: "Continue with new words" }));
    await waitFor(() => expect(reviewQueue).toHaveBeenLastCalledWith({ kind: "new", count: 10 }));
    await user.click(screen.getByRole("link", { name: "Continue with learning words" }));
    await waitFor(() =>
      expect(reviewQueue).toHaveBeenLastCalledWith({ kind: "learning", count: 20 }),
    );
  });

  it("says the word as a card shows, then its sentence after a short pause", async () => {
    const asked: string[] = [];
    const audioClip = vi.fn<(id: string) => Promise<Blob | null>>(async (id) => {
      asked.push(id.split("-")[0]!);
      return null;
    });
    const base = createMockServices({ latencyMs: 0, synced: true, native: true });
    const history = createMemoryHistory({ initialEntries: ["/review"] });
    render(<App services={{ ...base, audioClip }} history={history} />);
    await screen.findByText("de fiets");
    await waitFor(() => expect(asked).toEqual(["word", "sentence"]), { timeout: 3000 });
  });

  it("plays nothing by itself with autoplay off", async () => {
    const audioClip = vi.fn<(id: string) => Promise<Blob | null>>(async () => null);
    const base = createMockServices({ latencyMs: 0, synced: true, native: true });
    await base.saveSettings({ autoplayWord: false });
    const history = createMemoryHistory({ initialEntries: ["/review"] });
    render(<App services={{ ...base, audioClip }} history={history} />);
    await screen.findByText("de fiets");
    await new Promise((r) => setTimeout(r, 50));
    expect(audioClip).not.toHaveBeenCalled();
  });

  it("shows the front, then the answer and four buttons with intervals; keys answer", async () => {
    const { user } = setup("/review");
    expect(await screen.findByText("de fiets")).toBeVisible();
    expect(screen.getByText("Ik ga met de fiets naar mijn werk.")).toBeVisible();
    expect(screen.queryByText("bicycle")).toBeNull();
    await user.keyboard(" ");
    expect(await screen.findByText("bicycle")).toBeVisible();
    expect(screen.getByText(/From your texts/)).toBeVisible();
    expect(document.querySelector(".review-own mark")?.textContent).toBe("fiets");
    const group = screen.getByRole("group", { name: "How well did you know it?" });
    for (const label of ["Again", "Hard", "Good", "Easy"]) {
      expect(within(group).getByRole("button", { name: new RegExp(label) })).toBeVisible();
    }
    expect(within(group).getByRole("button", { name: /Again/ })).toHaveTextContent(/\dm/);
    await user.keyboard("3");
    expect(await screen.findByText("gezellig")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("1 done");
  });

  it("undoes the last answer", async () => {
    const { user } = setup();
    await screen.findByText("de fiets");
    await user.click(screen.getByRole("button", { name: /Show answer/ }));
    await user.click(screen.getByRole("button", { name: /Easy/ }));
    expect(await screen.findByText("gezellig")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /Undo/ }));
    expect(await screen.findByText("de fiets")).toBeVisible();
    await waitFor(() => expect(screen.queryByRole("button", { name: /Undo/ })).toBeNull());
    // The card comes back with its answer hidden, as the first time.
    expect(screen.queryByText("bicycle")).toBeNull();
    expect(screen.getByRole("button", { name: /Show answer/ })).toBeVisible();
  });

  it("undoes an answer from an earlier session, one after another", async () => {
    const services = createMockServices({ latencyMs: 0, synced: true, native: true });
    const first = render(
      <App services={services} history={createMemoryHistory({ initialEntries: ["/review"] })} />,
    );
    const user = userEvent.setup();
    await screen.findByText("de fiets");
    await user.keyboard(" ");
    await user.keyboard("4");
    expect(await screen.findByText("gezellig")).toBeVisible();
    await user.keyboard(" ");
    await user.keyboard("4");
    first.unmount();

    // A new session (a reload, another day): Undo takes back the stored answers.
    render(
      <App services={services} history={createMemoryHistory({ initialEntries: ["/review"] })} />,
    );
    const undo = await screen.findByRole("button", { name: /Undo/ });
    await user.click(undo);
    expect(await screen.findByText("gezellig")).toBeVisible();
    await user.keyboard("z");
    expect(await screen.findByText("de fiets")).toBeVisible();
    await waitFor(() => expect(screen.queryByRole("button", { name: /Undo/ })).toBeNull());
    expect(await services.lastReview()).toBeNull();
  });

  it("renders clozes and other templates sanitised", async () => {
    const { user } = setup();
    for (let i = 0; i < 2; i++) {
      await screen.findByRole("button", { name: /Show answer/ });
      await user.keyboard(" ");
      await user.keyboard("4");
    }
    expect(await screen.findByText(/elke dag naar school/)).toBeVisible();
    expect(document.querySelector(".review-html .cloze")?.textContent).toBe("[…]");
    await user.keyboard(" ");
    expect(await screen.findByText(/We walk to school/)).toBeVisible();
  });

  it("counts its cards on Words in the sidebar, in Due today and in Today on Read", async () => {
    setup("/");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    const words = await within(nav).findByRole("link", { name: /^Words/ });
    expect(await within(words).findByLabelText("2 cards due")).toBeVisible();
    expect(
      await screen.findByRole("link", { name: /^Due today · 4 cards · ~1 min/ }),
    ).toHaveAttribute("href", "/review");
    await userEvent.click(words);
    const today = await screen.findByRole("region", { name: "Due today" });
    expect(await within(today).findByText("4 cards")).toBeVisible();
  });

  it("strips scripts, handlers and foreign images from card HTML", () => {
    const html =
      '<div onclick="x()">a<script>alert(1)</script><img src="a.png"><img src="http://x/y.png"><iframe></iframe><b style="c">b</b></div>';
    expect(sanitizeCardHtml(html, { "a.png": "blob:1" })).toBe(
      '<div>a<img src="blob:1"><b>b</b></div>',
    );
  });
});
