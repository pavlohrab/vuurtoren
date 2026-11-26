import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentDevice } from "../../platform/index.js";
import { ServicesProvider } from "../../services/context.js";
import { createMockServices } from "../../services/mock.js";
import { ConnectPhone } from "./ConnectPhone.js";
import { PhoneAsking } from "../../shell/PhoneAsking.js";

vi.mock("../../platform/index.js", async (load) => {
  const real = await load<typeof import("../../platform/index.js")>();
  return { ...real, currentDevice: vi.fn(real.currentDevice) };
});

function setup(
  opts: {
    recovery?: string | null;
    folder?: string;
    firewallOpen?: boolean | null;
    asking?: { id: string; name: string } | null;
  } = {},
) {
  let open = opts.firewallOpen ?? null;
  let asking: { id: string; name: string } | null = opts.asking ?? null;
  const lan = {
    start: vi.fn(async () => ({
      port: 47120,
      fingerprint: "ab".repeat(32),
      addresses: ["192.168.1.20"],
      placeDir: "/data/sync-place",
    })),
    code: vi.fn(async () => "ABCDE-FGHJK"),
    phones: vi.fn(async () => [{ hash: "h1", name: "Pixel", device: "p1", vault: false }]),
    remove: vi.fn(async () => undefined),
    firewall: vi.fn(async () => ({
      tool: open === null ? null : ("firewalld" as const),
      open,
      command: "sudo firewall-cmd --permanent --add-port=47120/tcp && sudo firewall-cmd --reload",
    })),
    allowFirewall: vi.fn(async () => {
      open = true;
    }),
    asking: vi.fn(async () => asking),
    answer: vi.fn(async () => {
      asking = null;
      return true;
    }),
  };
  const real = currentDevice();
  vi.mocked(currentDevice).mockReturnValue({
    ...real,
    bridge: { lan } as unknown as NonNullable<typeof real.bridge>,
  });
  const startForPhones = vi.fn(
    async () =>
      ({ recoveryKey: opts.recovery ?? null, folder: opts.folder ?? "/data/sync-place" }) as never,
  );
  const phoneHandover = vi.fn(async () => "S0VZ");
  const services = { ...createMockServices({ latencyMs: 0 }), startForPhones, phoneHandover };
  render(
    <ServicesProvider services={services}>
      <QueryClientProvider client={new QueryClient()}>
        <ConnectPhone />
        <PhoneAsking />
      </QueryClientProvider>
    </ServicesProvider>,
  );
  return {
    lan,
    startForPhones,
    ask: (a: { id: string; name: string }) => {
      asking = a;
    },
  };
}

afterEach(() => vi.mocked(currentDevice).mockReset());

describe("Connect a phone", () => {
  it("asks 'Is this your phone?' on any screen before the key goes; Yes lets it in (SY12)", async () => {
    // No code on screen here: the user may have left Settings after showing it.
    const { lan } = setup({ asking: { id: "w1", name: "Pixel 8" } });
    const dialog = await screen.findByRole("dialog", { name: "A phone wants to connect" });
    expect(dialog).toHaveTextContent("Pixel 8");
    await userEvent.click(screen.getByRole("button", { name: "Yes, it's mine" }));
    expect(lan.answer).toHaveBeenCalledWith("w1", true);
  });

  it("No ends the code: a new one is needed (SY12)", async () => {
    const { lan, ask } = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Show the code" }));
    ask({ id: "w1", name: "Pixel 8" });
    await screen.findByRole("dialog", { name: "A phone wants to connect" });
    await userEvent.click(screen.getByRole("button", { name: "No" }));
    expect(lan.answer).toHaveBeenCalledWith("w1", false);
    expect(await screen.findByText(/That phone got nothing/)).toBeVisible();
    expect(screen.getByRole("button", { name: "New code" })).toBeVisible();
  });

  it("when firewalld keeps the phone out, it offers to let Vuurtoren through (SY9)", async () => {
    const { lan } = setup({ firewallOpen: false });
    await userEvent.click(await screen.findByRole("button", { name: "Show the code" }));
    expect(await screen.findByText(/firewall keeps your phone out/)).toBeVisible();
    expect(screen.getByText(/firewall-cmd --permanent --add-port=47120/)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Allow Vuurtoren" }));
    expect(lan.allowFirewall).toHaveBeenCalledWith(47120);
    expect(await screen.findByText(/The firewall lets your phone in now/)).toBeVisible();
    expect(screen.queryByText(/firewall keeps your phone out/)).toBeNull();
  });

  it("says nothing about a firewall it can't ask, or one that is open", async () => {
    setup({ firewallOpen: true });
    await userEvent.click(await screen.findByRole("button", { name: "Show the code" }));
    await screen.findByText("ABCDE-FGHJK");
    expect(screen.queryByText(/firewall/i)).toBeNull();
  });

  it("shows a QR code with the code; the phone gets the key with it", async () => {
    const { lan, startForPhones } = setup({ recovery: "AAAA-BBBB" });
    await userEvent.click(await screen.findByRole("button", { name: "Show the code" }));
    expect(await screen.findByRole("img", { name: "Code to scan with your phone" })).toBeVisible();
    expect(screen.getByText("ABCDE-FGHJK")).toBeVisible();
    expect(startForPhones).toHaveBeenCalledWith("/data/sync-place", "");
    expect(lan.code).toHaveBeenCalledWith({ key: "S0VZ" });
    // A computer that just started sync shows its recovery key once.
    expect(screen.getByText("AAAA-BBBB")).toBeVisible();
    expect(lan.start).toHaveBeenCalledTimes(1);
  });

  it("a computer on Syncthing serves that folder to its phone", async () => {
    const { lan } = setup({ folder: "/home/me/Sync/vuurtoren" });
    await userEvent.click(await screen.findByRole("button", { name: "Show the code" }));
    expect(await screen.findByText("ABCDE-FGHJK")).toBeVisible();
    expect(lan.start).toHaveBeenLastCalledWith("/home/me/Sync/vuurtoren");
  });

  it("lists the phones, and Remove takes one off", async () => {
    const { lan } = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Remove" }));
    expect(lan.remove).toHaveBeenCalledWith("h1");
  });
});
