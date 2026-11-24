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

function onPhone(
  opts: {
    received?: number;
    connection?: string;
    install?: () => Promise<"server" | "release">;
  } = {},
) {
  const install = vi.fn(opts.install ?? (() => Promise.resolve("server" as const)));
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
  vi.restoreAllMocks();
  vi.mocked(currentDevice).mockReset();
  localStorage.clear();
  Reflect.deleteProperty(navigator, "connection");
});

describe("DictionaryPack", () => {
  it("on Wi-Fi: downloads by itself, with the connected server as the second source", async () => {
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

  it("a download that fails says so in plain words, the reason folded away, with Retry", async () => {
    let fail = true;
    const install = onPhone({
      connection: "wifi",
      install: () =>
        fail ? Promise.reject(new Error("HTTP 404 from the server")) : new Promise(() => {}),
    });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The dictionary did not download. Check the connection");
    // The technical reason is there for a bug report, behind Technical details.
    expect(alert.querySelector("details code")).toHaveTextContent("HTTP 404 from the server");
    expect(screen.queryByText(/0 B of/)).toBeNull();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(install).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(/Starting the download/)).toBeVisible();
    expect(screen.getByRole("progressbar", { name: "Dictionary download" })).toHaveClass(
      "k-progress",
    );
  });

  it("offline: says so instead of starting, with Retry", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const install = onPhone({ connection: "wifi" });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No connection: the dictionary downloads once you are online.",
    );
    expect(install).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
  });
});
