import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App.js";
import { createMockServices } from "../services/mock.js";
import type { AppServices } from "../services/types.js";

/** A touch screen: matchMedia says the pointer is coarse. */
function touchScreen() {
  const real = window.matchMedia;
  vi.spyOn(window, "matchMedia").mockImplementation(
    (q: string) => ({ ...real(q), matches: q.includes("pointer: coarse") }) as MediaQueryList,
  );
}

function setup(path: string, patch: Partial<AppServices> = {}) {
  const services = { ...createMockServices({ latencyMs: 0 }), ...patch };
  render(<App services={services} history={createMemoryHistory({ initialEntries: [path] })} />);
  return userEvent.setup();
}

afterEach(() => vi.restoreAllMocks());

describe("Add text on a phone", () => {
  it("offers Choose photo and Take photo (the camera), then a preview with Replace and Remove", async () => {
    touchScreen();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:photo");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const user = setup("/import?tab=photo");
    expect(await screen.findByRole("button", { name: /Choose photo/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /Take photo/ })).toBeVisible();
    expect(screen.queryByText(/drop it here/)).toBeNull();
    const camera = screen.getByLabelText("Take photo");
    expect(camera).toHaveAttribute("capture", "environment");
    expect(camera).toHaveAttribute("accept", "image/*");
    await user.upload(camera, new File(["x"], "page.jpg", { type: "image/jpeg" }));
    expect(screen.getByRole("img", { name: /page\.jpg/ })).toHaveAttribute("src", "blob:photo");
    expect(screen.getByRole("button", { name: "Replace" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.queryByRole("img", { name: /page\.jpg/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Choose photo/ })).toBeVisible();
  });

  it("says Choose PDF, and keeps the chosen file in view when the import fails", async () => {
    touchScreen();
    const importText = vi.fn(async () => {
      throw new Error("The server could not read the PDF.");
    });
    const user = setup("/import?tab=pdf", { importText });
    await user.upload(
      await screen.findByLabelText("Choose PDF"),
      new File(["%PDF"], "les-3.pdf", { type: "application/pdf" }),
    );
    await user.click(screen.getByRole("button", { name: "Add to my texts" }));
    expect(await screen.findByText(/could not read the PDF/)).toBeVisible();
    expect(screen.getByText("les-3.pdf")).toBeVisible();
    expect(screen.getByRole("button", { name: "Replace" })).toBeVisible();
  });
});
