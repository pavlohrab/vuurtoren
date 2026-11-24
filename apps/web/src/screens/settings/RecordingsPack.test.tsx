import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentDevice } from "../../platform/index.js";
import { ServicesProvider } from "../../services/context.js";
import { createMockServices } from "../../services/mock.js";
import { RecordingsPack } from "./RecordingsPack.js";

vi.mock("../../platform/index.js", async (load) => {
  const real = await load<typeof import("../../platform/index.js")>();
  return { ...real, currentDevice: vi.fn(real.currentDevice) };
});

function onPhone() {
  const install = vi.fn(() => Promise.resolve("release" as const));
  const real = currentDevice();
  const audio = {
    status: vi.fn(() =>
      Promise.resolve({ installed: false, bytes: 0, download: 229_959_398, received: 0 }),
    ),
    install,
    remove: vi.fn(() => Promise.resolve()),
  };
  vi.mocked(currentDevice).mockReturnValue({
    ...real,
    kind: "android",
    bridge: { audio } as unknown as NonNullable<typeof real.bridge>,
  });
  render(
    <ServicesProvider services={createMockServices({ latencyMs: 0 })}>
      <QueryClientProvider client={new QueryClient()}>
        <RecordingsPack ask />
      </QueryClientProvider>
    </ServicesProvider>,
  );
  return install;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(currentDevice).mockReset();
});

describe("RecordingsPack in onboarding", () => {
  it("asks once, plainly: Download or Not now; nothing downloads by itself", async () => {
    const install = onPhone();
    expect(await screen.findByText("Download recordings of the words?")).toBeVisible();
    expect(screen.getByText(/best on Wi-Fi/)).toBeVisible();
    expect(install).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByText("Download recordings of the words?")).toBeNull();
    expect(install).not.toHaveBeenCalled();
  });

  it("Download starts it", async () => {
    const install = onPhone();
    await userEvent.click(await screen.findByRole("button", { name: "Download" }));
    expect(install).toHaveBeenCalledOnce();
  });
});
