import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentDevice } from "../../platform/index.js";
import { ServicesProvider } from "../../services/context.js";
import { createMockServices } from "../../services/mock.js";
import { ConnectPhone } from "./ConnectPhone.js";

vi.mock("../../platform/index.js", async (load) => {
  const real = await load<typeof import("../../platform/index.js")>();
  return { ...real, currentDevice: vi.fn(real.currentDevice) };
});

function setup(opts: { recovery?: string | null } = {}) {
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
  };
  const real = currentDevice();
  vi.mocked(currentDevice).mockReturnValue({
    ...real,
    bridge: { lan } as unknown as NonNullable<typeof real.bridge>,
  });
  const startForPhones = vi.fn(async () => ({ recoveryKey: opts.recovery ?? null }) as never);
  const phoneHandover = vi.fn(async () => "S0VZ");
  const services = { ...createMockServices({ latencyMs: 0 }), startForPhones, phoneHandover };
  render(
    <ServicesProvider services={services}>
      <QueryClientProvider client={new QueryClient()}>
        <ConnectPhone />
      </QueryClientProvider>
    </ServicesProvider>,
  );
  return { lan, startForPhones };
}

afterEach(() => vi.mocked(currentDevice).mockReset());

describe("Connect a phone", () => {
  it("shows a QR code with the code; the phone gets the key with it", async () => {
    const { lan, startForPhones } = setup({ recovery: "AAAA-BBBB" });
    await userEvent.click(await screen.findByRole("button", { name: "Show the code" }));
    expect(await screen.findByRole("img", { name: "Code to scan with your phone" })).toBeVisible();
    expect(screen.getByText("ABCDE-FGHJK")).toBeVisible();
    expect(startForPhones).toHaveBeenCalledWith("/data/sync-place", "");
    expect(lan.code).toHaveBeenCalledWith({ key: "S0VZ" });
    // A computer that just started sync shows its recovery key once.
    expect(screen.getByText("AAAA-BBBB")).toBeVisible();
  });

  it("lists the phones, and Remove takes one off", async () => {
    const { lan } = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Remove" }));
    expect(lan.remove).toHaveBeenCalledWith("h1");
  });
});
