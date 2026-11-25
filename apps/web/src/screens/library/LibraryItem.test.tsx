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
import { ServicesProvider } from "../../services/context.js";
import { createMockServices } from "../../services/mock.js";
import type { TextListItem } from "../../services/types.js";
import { LibraryItem } from "./LibraryItem.js";

vi.mock("../../platform/index.js", async (load) => {
  const real = await load<typeof import("../../platform/index.js")>();
  return { ...real, currentDevice: vi.fn(real.currentDevice) };
});

const TEXT = {
  id: "t1",
  title: "Een brief",
  lang: "nl",
  sourceKind: "paste",
  createdAt: 0,
  wordCount: 120,
  analyzed: false,
  lastSegment: 0,
  coverage: null,
  newTypes: null,
  pages: null,
} as unknown as TextListItem;

function show(phone: boolean) {
  const real = currentDevice();
  vi.mocked(currentDevice).mockReturnValue({ ...real, kind: phone ? "android" : real.kind });
  const services = {
    ...createMockServices({ latencyMs: 0 }),
    syncStatus: async () => ({ place: null }) as never,
  };
  const Item = () => (
    <LibraryItem
      text={TEXT}
      variant="shelf"
      menu={[]}
      onToggle={() => {}}
      selecting={false}
      selected={false}
      dragIds={() => ["t1"]}
    />
  );
  const router = createRouter({
    routeTree: createRootRoute({ component: Item }),
    history: createMemoryHistory(),
  });
  render(
    <ServicesProvider services={services}>
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ServicesProvider>,
  );
}

afterEach(() => vi.mocked(currentDevice).mockReset());

describe("LibraryItem", () => {
  it("on a phone without a server, a text not prepared yet waits for the computer", async () => {
    show(true);
    expect(await screen.findByText("Waiting for your computer")).toBeVisible();
  });

  it("on a computer it shows the word count as before", async () => {
    show(false);
    expect(await screen.findByText("120 words")).toBeVisible();
  });
});
