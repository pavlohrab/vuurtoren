import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "../App.js";
import { createMockServices } from "../services/mock.js";

function setup(path = "/library") {
  const services = createMockServices({ latencyMs: 0 });
  const history = createMemoryHistory({ initialEntries: [path] });
  render(<App services={services} history={history} />);
  return { services, history, user: userEvent.setup() };
}

async function openPalette(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Open command palette" }));
  return screen.findByRole("dialog", { name: "Command palette" });
}

describe("command palette", () => {
  it("offers actions, Exam among the pages, and texts", async () => {
    const { user, history } = setup();
    const dialog = await openPalette(user);
    expect(within(dialog).getByRole("option", { name: "Add text" })).toBeInTheDocument();
    expect(within(dialog).getByRole("option", { name: "Start practice" })).toBeInTheDocument();
    expect(within(dialog).getByRole("option", { name: "Exam" })).toBeInTheDocument();
    expect(await within(dialog).findByRole("option", { name: "Het weer" })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("option", { name: "Start practice" }));
    await waitFor(() => expect(history.location.pathname).toBe("/practice"));
  });

  it("finds a word as you type and opens it in Words", async () => {
    const { user, services, history } = setup();
    const [word] = await services.words({ limit: 1 });
    const dialog = await openPalette(user);
    await user.type(within(dialog).getByRole("combobox"), word!.key);
    const option = await within(dialog).findByRole("option", {
      name: new RegExp(`(^|\\s)${word!.key}( ·|$)`),
    });
    await user.click(option);
    await waitFor(() => expect(history.location.pathname).toBe("/words"));
    expect(history.location.search).toContain(`word=${word!.key}`);
  });
});
