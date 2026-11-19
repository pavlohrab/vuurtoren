import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "../../App.js";
import { createMockServices } from "../../services/mock.js";

async function toReview() {
  const services = createMockServices({ latencyMs: 0 });
  const history = createMemoryHistory({ initialEntries: ["/import"] });
  render(<App services={services} history={history} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("tab", { name: "Photo" }));
  await user.upload(
    screen.getByLabelText("Choose a photo or drop it here"),
    new File(["x"], "page.jpg", { type: "image/jpeg" }),
  );
  await user.click(screen.getByRole("button", { name: "Add to Library" }));
  await screen.findByRole("heading", { name: "Check the text" });
  return { services, history, user };
}

describe("OCR review in Import", () => {
  it("fixes words by keyboard and by Accept all, then imports the corrected text", async () => {
    const { services, history, user } = await toReview();
    expect(screen.getByRole("status")).toHaveTextContent("4 words to check");
    // The first flagged word is chosen: take its first suggestion with "1".
    expect(screen.getByRole("button", { name: "hu1s", pressed: true })).toBeInTheDocument();
    await user.keyboard("1");
    expect(screen.getByRole("status")).toHaveTextContent("3 words to check");
    // Now "rnaakt" is chosen; move on to "soep" and keep it.
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("button", { name: "soep", pressed: true })).toBeInTheDocument();
    await user.keyboard("k");
    await user.click(screen.getByRole("button", { name: "More for this text" }));
    await user.click(await screen.findByRole("menuitem", { name: "Accept all suggestions" }));
    expect(screen.getByRole("status")).toHaveTextContent("All 4 words checked.");
    await user.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(history.location.pathname).toMatch(/^\/read\//));
    const id = history.location.pathname.split("/").pop() ?? "";
    const view = await services.getReading(id);
    const text = view?.text.content ?? "";
    expect(text).toContain("voor het huis");
    expect(text).toContain("maakt een grote pot soep");
    expect(text).toContain("onze vrienden");
  });

  it("types a correction and can cancel the import", async () => {
    const { history, user } = await toReview();
    await user.keyboard("e");
    const box = screen.getByLabelText("Correct word");
    await user.clear(box);
    await user.type(box, "huizen{Enter}");
    expect(screen.getByRole("button", { name: "huizen" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("heading", { name: "Add text" })).toBeInTheDocument();
    expect(history.location.pathname).toBe("/import");
  });
});
