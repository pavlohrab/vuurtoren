import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "../../App.js";
import { createMockServices } from "../../services/mock.js";

function setup() {
  const services = createMockServices({ latencyMs: 0, synced: true });
  const history = createMemoryHistory({ initialEntries: ["/settings?section=sync"] });
  render(<App services={services} history={history} />);
  return { services, user: userEvent.setup() };
}

describe("Settings → Sync", { timeout: 20_000 }, () => {
  it("sets up sync with a server, shows the devices, syncs now and stops", async () => {
    const { user, services } = setup();
    expect(await screen.findByRole("heading", { name: "Sync your devices" })).toBeVisible();
    // Folders need the desktop app.
    expect(screen.queryByRole("radio", { name: /folder you already sync/ })).toBeNull();
    const start = screen.getByRole("button", { name: "Start syncing" });
    expect(start).toBeDisabled();
    await user.type(screen.getByLabelText("Server address"), "https://kenning.example.org");
    await user.type(screen.getByLabelText("Sync token"), "ksync_abc");
    await user.type(screen.getByLabelText("Passphrase"), "short");
    expect(start).toBeDisabled();
    await user.type(screen.getByLabelText("Passphrase"), " but longer now");
    await user.click(start);

    expect(await screen.findByText("Sync is on")).toBeVisible();
    expect(screen.getByText(/Kenning server · kenning\.example\.org/)).toBeVisible();
    const devices = screen.getByRole("list", { name: "Devices" });
    expect(within(devices).getByText("Phone")).toBeVisible();
    expect(within(devices).getByText("this device")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Sync now" }));
    await user.click(screen.getByRole("button", { name: "Stop syncing…" }));
    await user.click(screen.getByRole("button", { name: "Stop syncing" }));
    expect(await screen.findByRole("button", { name: "Start syncing" })).toBeVisible();
    expect((await services.syncStatus()).place).toBeNull();
  });

  it("offers WebDAV and GitHub with their own fields", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("radio", { name: /WebDAV/ }));
    expect(screen.getByLabelText("App password")).toBeVisible();
    await user.click(screen.getByRole("radio", { name: /private GitHub repository/ }));
    expect(screen.getByLabelText("Repository")).toBeVisible();
  });
});
