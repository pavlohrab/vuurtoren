import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readUpdates, writeUpdates } from "../../updates.js";
import { APP_VERSION } from "../../version.js";
import { UpdateCard } from "./UpdateCard.js";

const device = vi.hoisted(() => ({ kind: "android" as string }));
vi.mock("../../platform/index.js", () => ({ currentDevice: () => device }));

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <UpdateCard />
    </QueryClientProvider>,
  );
}

describe("UpdateCard", () => {
  beforeEach(() => {
    localStorage.clear();
    device.kind = "android";
    // Asked a moment ago: no request, the last answer counts.
    writeUpdates({ checkedAt: Date.now(), latest: "99.0.0" });
  });

  it("tells about a newer version on the phone; Not now waits for the next one", async () => {
    show();
    expect(await screen.findByText("Vuurtoren 99.0.0 is out.")).toBeInTheDocument();
    expect(screen.getByText(`You have ${APP_VERSION}.`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByText("Vuurtoren 99.0.0 is out.")).toBeNull();
    expect(readUpdates().dismissed).toBe("99.0.0");
  });

  it("stays away on a computer (it updates itself)", async () => {
    device.kind = "desktop";
    const { container } = show();
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });
});
