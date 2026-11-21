import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentDevice } from "../../platform/index.js";
import { ServicesProvider } from "../../services/context.js";
import { createMockServices } from "../../services/mock.js";
import { DictionaryPack } from "./DictionaryPack.js";

vi.mock("../../platform/index.js", async (load) => {
  const real = await load<typeof import("../../platform/index.js")>();
  return { ...real, currentDevice: vi.fn(real.currentDevice) };
});

const SERVER = { nlp: "https://vuur.example/nlp", token: "tok" };

function onPhone(opts: { received?: number; connection?: string } = {}) {
  const install = vi.fn(() => Promise.resolve("server" as const));
  const real = currentDevice();
  const dictionary = {
    status: vi.fn(() =>
      Promise.resolve({
        installed: false,
        bytes: 0,
        download: 14_073_216,
        received: opts.received ?? 0,
      }),
    ),
    gloss: vi.fn(() => Promise.resolve(null)),
    install,
  };
  vi.mocked(currentDevice).mockReturnValue({
    ...real,
    kind: "android",
    bridge: { dictionary } as unknown as NonNullable<typeof real.bridge>,
  });
  Object.defineProperty(navigator, "connection", {
    value: opts.connection ? { type: opts.connection } : undefined,
    configurable: true,
  });
  const services = { ...createMockServices({ latencyMs: 0 }), packSource: async () => SERVER };
  render(
    <ServicesProvider services={services}>
      <QueryClientProvider client={new QueryClient()}>
        <DictionaryPack autoStart />
      </QueryClientProvider>
    </ServicesProvider>,
  );
  return install;
}

afterEach(() => {
  vi.mocked(currentDevice).mockReset();
  localStorage.clear();
  Reflect.deleteProperty(navigator, "connection");
});

describe("DictionaryPack", () => {
  it("on Wi-Fi: downloads by itself, from the connected server first", async () => {
    const install = onPhone({ connection: "wifi" });
    await vi.waitFor(() => expect(install).toHaveBeenCalledWith(SERVER));
  });

  it("on mobile data: waits for Wi-Fi unless the learner says so", async () => {
    const install = onPhone({ connection: "cellular" });
    expect(await screen.findByText("Waiting for Wi-Fi.")).toBeVisible();
    expect(install).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /Download now on mobile data/ }));
    expect(install).toHaveBeenCalledOnce();
  });

  it("a download that stopped goes on from where it was", async () => {
    onPhone({ connection: "cellular", received: 7_000_000 });
    expect(
      await screen.findByRole("button", { name: "Go on with the download (6.7 MB of 13 MB)" }),
    ).toBeVisible();
    expect(
      screen.getByRole("checkbox", { name: "Also download on mobile data" }),
    ).not.toBeChecked();
  });
});
