import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../services/context.js";
import { createMockServices } from "../services/mock.js";
import { useCanAddTexts } from "./canAddTexts.js";
import { currentDevice } from "./index.js";

vi.mock("./index.js", async (load) => {
  const real = await load<typeof import("./index.js")>();
  return { ...real, currentDevice: vi.fn(real.currentDevice) };
});

function Probe() {
  return <p>{useCanAddTexts() ? "can add" : "can't add"}</p>;
}

function show(place: { kind: string; label: string; computer?: boolean } | null) {
  const real = currentDevice();
  vi.mocked(currentDevice).mockReturnValue({ ...real, kind: "android" });
  const services = {
    ...createMockServices({ latencyMs: 0 }),
    syncStatus: async () => ({ place }) as never,
  };
  render(
    <ServicesProvider services={services}>
      <QueryClientProvider client={new QueryClient()}>
        <Probe />
      </QueryClientProvider>
    </ServicesProvider>,
  );
}

afterEach(() => vi.mocked(currentDevice).mockReset());

describe("Add text on a phone", () => {
  it("is there with a server", async () => {
    show({ kind: "server", label: "vuurtoren.example" });
    expect(await screen.findByText("can add")).toBeInTheDocument();
  });
  it("is not there when the phone is linked to its computer (SY6)", async () => {
    show({ kind: "server", label: "Your computer", computer: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText("can't add")).toBeInTheDocument();
  });
});
