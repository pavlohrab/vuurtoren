import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App.js";
import { createMockServices } from "../../services/mock.js";
import type { SyncStatus } from "../../services/syncTypes.js";
import type { AppServices } from "../../services/types.js";
import type { AccountControls } from "../../shell/AppInfo.js";

function setup(
  over: Partial<AppServices> = {},
  account?: AccountControls,
): { services: AppServices; user: ReturnType<typeof userEvent.setup>; unmount: () => void } {
  const services = { ...createMockServices({ latencyMs: 0, synced: true }), ...over };
  const history = createMemoryHistory({ initialEntries: ["/settings?section=sync"] });
  const { unmount } = render(<App services={services} history={history} account={account} />);
  return { services, user: userEvent.setup(), unmount };
}

const OFF: SyncStatus = {
  desktop: false,
  thisServer: null,
  place: null,
  deviceName: "Laptop",
  last: null,
  error: null,
  needsKey: false,
  devices: [],
  problems: [],
};

const anna: AccountControls = {
  authEnabled: true,
  user: "anna",
  via: "session",
  signOut: async () => {},
  signOutAll: async () => {},
};

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

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
    // The recovery key, until it is saved (also after a reload of this tab).
    expect(screen.getByText("K7QM-2XRA-9F4D-HV3C-T8NW-5BJP-6GZE-1YKS")).toBeVisible();
    expect(sessionStorage.getItem("vuurtoren.sync.recovery")).toBe(
      "K7QM-2XRA-9F4D-HV3C-T8NW-5BJP-6GZE-1YKS",
    );
    await user.click(screen.getByRole("button", { name: "I have saved it" }));
    expect(sessionStorage.getItem("vuurtoren.sync.recovery")).toBeNull();
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

  it("keeps a recovery key that is not saved yet when the page opens again", async () => {
    sessionStorage.setItem("vuurtoren.sync.recovery", "AAAA-BBBB");
    const { user } = setup();
    expect(await screen.findByText("AAAA-BBBB")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "I have saved it" }));
    expect(screen.queryByText("AAAA-BBBB")).toBeNull();
  });

  it("offers a folder and WebDAV in the desktop app only", async () => {
    const { user, unmount } = setup({ syncStatus: async () => OFF });
    await screen.findByRole("radio", { name: /Your Vuurtoren server/ });
    expect(screen.queryByRole("radio", { name: /WebDAV/ })).toBeNull();
    expect(screen.queryByRole("radio", { name: /folder you already sync/ })).toBeNull();
    unmount();
    setup({ syncStatus: async () => ({ ...OFF, desktop: true }) });
    await user.click(await screen.findByRole("radio", { name: /WebDAV/ }));
    expect(screen.getByLabelText("App password")).toBeVisible();
    expect(screen.getByRole("radio", { name: /folder you already sync/ })).toBeVisible();
    expect(screen.queryByRole("radio", { name: /GitHub/ })).toBeNull();
  });

  it("on a page of a Vuurtoren server offers This server, and makes tokens for other devices", async () => {
    const setUpSync = vi.fn(createMockServices({ latencyMs: 0 }).setUpSync);
    const posted: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          posted.push(JSON.parse(String(init.body)));
          return Response.json({ ok: true, id: "ffffffffffff", token: "ksync_new" });
        }
        return Response.json({ ok: true, tokens: [] });
      }),
    );
    const { user } = setup(
      {
        syncStatus: async () => ({ ...OFF, thisServer: "https://vuurtoren.example.org" }),
        setUpSync,
      },
      anna,
    );
    const here = await screen.findByRole("radio", { name: /This server/ });
    expect(here).toBeChecked();
    // No address or token to type: the page makes its own token.
    expect(screen.queryByLabelText("Sync token")).toBeNull();
    await user.click(screen.getByRole("radio", { name: /Start new sync data here/ }));
    await user.type(screen.getByLabelText("Passphrase"), "lange zinnen lezen");
    await user.click(screen.getByRole("button", { name: "Start syncing" }));
    expect(setUpSync).toHaveBeenCalledWith(
      { kind: "server", url: "https://vuurtoren.example.org", token: "" },
      "start",
      "lange zinnen lezen",
      "Laptop",
      expect.any(Function),
    );

    // Sync tokens for the phone, which may change the passphrase.
    await user.click(screen.getByRole("checkbox", { name: /May change the passphrase/ }));
    await user.click(screen.getByRole("button", { name: "Make a sync token" }));
    expect(await screen.findByText("ksync_new")).toBeVisible();
    expect(posted).toEqual([{ label: "Phone", vault: true }]);
  });

  it("asks for the passphrase when this device lost its key, and lists what did not sync", async () => {
    const unlockSync = vi.fn(async () => ({
      ...OFF,
      place: { kind: "server" as const, label: "x" },
    }));
    const { user } = setup({
      syncStatus: async () => ({
        ...OFF,
        place: { kind: "server", label: "Vuurtoren server · vuurtoren.example.org" },
        needsKey: true,
        error: "This device does not have its sync key.",
        problems: [
          { what: "vuurtoren/devices/abc/01J.kev", error: "It does not open.", leftOut: true },
        ],
      }),
      unlockSync,
    });
    await user.type(await screen.findByLabelText("Enter passphrase"), "lange zinnen lezen");
    await user.click(screen.getByRole("button", { name: "Unlock sync" }));
    expect(unlockSync).toHaveBeenCalledWith("lange zinnen lezen");
    await user.click(screen.getByText("1 file or change not synced"));
    const list = screen.getByRole("list", { name: "Not synced" });
    expect(within(list).getByText(/It does not open/)).toBeVisible();
  });
});
