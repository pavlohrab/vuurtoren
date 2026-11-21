import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentDevice } from "../../platform/index.js";
import { DictionaryPack } from "./DictionaryPack.js";

vi.mock("../../platform/index.js", async (load) => {
  const real = await load<typeof import("../../platform/index.js")>();
  return { ...real, currentDevice: vi.fn(real.currentDevice) };
});

function onPhone(status: { installed: boolean; unpacking?: boolean }) {
  const install = vi.fn(() => Promise.resolve());
  const real = currentDevice();
  const dictionary = {
    status: vi.fn(() => Promise.resolve({ bytes: 0, download: 14_073_216, ...status })),
    gloss: vi.fn(() => Promise.resolve(null)),
    install,
  };
  vi.mocked(currentDevice).mockReturnValue({
    ...real,
    kind: "android",
    bridge: { dictionary } as unknown as NonNullable<typeof real.bridge>,
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DictionaryPack autoStart />
    </QueryClientProvider>,
  );
  return install;
}

afterEach(() => vi.mocked(currentDevice).mockReset());

describe("DictionaryPack", () => {
  it("while the dictionary the app carries is unpacked: a note, no download", async () => {
    const install = onPhone({ installed: false, unpacking: true });
    expect(
      await screen.findByText(/Setting up the dictionary that came with the app/),
    ).toBeVisible();
    expect(install).not.toHaveBeenCalled();
  });

  it("without one in the app: downloads it by itself", async () => {
    const install = onPhone({ installed: false });
    await vi.waitFor(() => expect(install).toHaveBeenCalledOnce());
  });
});
