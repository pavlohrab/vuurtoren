import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentDevice } from "../../platform/index.js";
import { DictionaryMissing } from "./DictionaryMissing.js";

vi.mock("../../platform/index.js", async (load) => {
  const real = await load<typeof import("../../platform/index.js")>();
  return { ...real, currentDevice: vi.fn(real.currentDevice) };
});

function onPhone(status: { installed: boolean; downloading?: boolean }) {
  const real = currentDevice();
  vi.mocked(currentDevice).mockReturnValue({
    ...real,
    kind: "android",
    bridge: {
      dictionary: { status: async () => ({ bytes: 0, download: 1, ...status }) },
    } as unknown as NonNullable<typeof real.bridge>,
  });
  const router = createRouter({
    routeTree: createRootRoute({ component: DictionaryMissing }),
    history: createMemoryHistory(),
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.mocked(currentDevice).mockReset());

describe("DictionaryMissing", () => {
  it("says plainly where to get the dictionary when the phone has none", async () => {
    onPhone({ installed: false });
    expect(await screen.findByText(/No dictionary on this phone yet/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Get it in Settings" })).toBeVisible();
  });

  it("says nothing once it is there", async () => {
    onPhone({ installed: true });
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText(/dictionary/)).toBeNull();
  });
});
