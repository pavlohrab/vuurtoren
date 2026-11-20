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
    await user.click(screen.getByRole("radio", { name: /Start new sync data here/ }));
    await user.type(screen.getByLabelText("Server address"), "https://vuurtoren.example.org");
    await user.type(screen.getByLabelText("Sync token"), "ksync_abc");
    await user.type(screen.getByLabelText("Passphrase"), "short");
    expect(start).toBeDisabled();
    await user.type(screen.getByLabelText("Passphrase"), " but longer now");
    await user.click(start);

    expect(await screen.findByText("Sync is on")).toBeVisible();
    // The recovery key, once.
    expect(screen.getByText("K7QM-2XRA-9F4D-HV3C-T8NW-5BJP-6GZE-1YKS")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "I have saved it" }));
    expect(screen.queryByText("K7QM-2XRA-9F4D-HV3C-T8NW-5BJP-6GZE-1YKS")).toBeNull();
    // Change the passphrase; make a new recovery key.
    await user.click(screen.getByRole("button", { name: "Change passphrase…" }));
    await user.type(
      screen.getByLabelText("Current passphrase or recovery key"),
      "short but longer now",
    );
    await user.type(screen.getByLabelText("New passphrase"), "een nieuwe zin");
    await user.click(screen.getByRole("button", { name: "Change passphrase" }));
    expect(await screen.findByText("Passphrase changed")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Make a new recovery key…" }));
    await user.type(screen.getByLabelText("Current passphrase or recovery key"), "een nieuwe zin");
    await user.click(screen.getByRole("button", { name: "Make a new recovery key" }));
    expect(await screen.findByText("P3VD-8KQA-2MXN-7HTF-4WJC-9ZBE-6RGS-1YQK")).toBeVisible();
    // A failed attempt's error goes with Cancel, and does not come back with the next form.
    await user.click(screen.getByRole("button", { name: "Change passphrase…" }));
    await user.type(screen.getByLabelText("Current passphrase or recovery key"), "kort");
    await user.type(screen.getByLabelText("New passphrase"), "nog een nieuwe zin");
    await user.click(screen.getByRole("button", { name: "Change passphrase" }));
    expect(
      await screen.findByText("This passphrase does not open your synced data."),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("This passphrase does not open your synced data.")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Make a new recovery key…" }));
    expect(screen.queryByRole("alert")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText(/Vuurtoren server · vuurtoren\.example\.org/)).toBeVisible();
    const devices = screen.getByRole("list", { name: "Devices" });
    expect(within(devices).getByText("Phone")).toBeVisible();
    expect(within(devices).getByText("this device")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Sync now" }));
    await user.click(screen.getByRole("button", { name: "Stop syncing…" }));
    await user.click(screen.getByRole("button", { name: "Stop syncing" }));
    expect(await screen.findByRole("button", { name: "Start syncing" })).toBeVisible();
    expect((await services.syncStatus()).place).toBeNull();
  });

  it("joins data another device started: no recovery key, its passphrase", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("radio", { name: /Join my synced data/ }));
    expect(screen.getByLabelText("Passphrase or recovery key")).toBeVisible();
    await user.type(screen.getByLabelText("Server address"), "https://vuurtoren.example.org");
    await user.type(screen.getByLabelText("Sync token"), "ksync_abc");
    await user.type(screen.getByLabelText("Passphrase or recovery key"), "lange zinnen lezen");
    await user.click(screen.getByRole("button", { name: "Join and sync" }));
    expect(await screen.findByText("Sync is on")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Your recovery key" })).toBeNull();
  });

  it("offers WebDAV and GitHub with their own fields", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("radio", { name: /WebDAV/ }));
    expect(screen.getByLabelText("App password")).toBeVisible();
    await user.click(screen.getByRole("radio", { name: /private GitHub repository/ }));
    expect(screen.getByLabelText("Repository")).toBeVisible();
  });
});
