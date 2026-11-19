import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
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

  it("is in the sidebar with the due count, and on Home", async () => {
    setup("/");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    const link = await within(nav).findByRole("link", { name: /Review/ });
    expect(within(link).getByLabelText("2 cards due")).toBeVisible();
    expect(await screen.findByRole("link", { name: /Review.*2 due · 2 new/ })).toBeVisible();
  });

  it("strips scripts, handlers and foreign images from card HTML", () => {
    const html =
      '<div onclick="x()">a<script>alert(1)</script><img src="a.png"><img src="http://x/y.png"><iframe></iframe><b style="c">b</b></div>';
    expect(sanitizeCardHtml(html, { "a.png": "blob:1" })).toBe(
      '<div>a<img src="blob:1"><b>b</b></div>',
    );
  });
});
