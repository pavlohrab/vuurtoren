import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../../App.js";
import { createMockServices } from "../../services/mock.js";
import type { AppServices } from "../../services/types.js";

function setup(path: string, patch: Partial<AppServices> = {}) {
  const base = createMockServices({ latencyMs: 0 });
  const services: AppServices = { ...base, ...patch };
  const history = createMemoryHistory({ initialEntries: [path] });
  render(<App services={services} history={history} />);
  return { services, history, user: userEvent.setup() };
}

describe("Courses", () => {
  it("is in the sidebar and lists the course with its progress", async () => {
    const { user, history } = setup("/library");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    await user.click(within(nav).getByRole("link", { name: "Courses" }));
    expect(history.location.pathname).toBe("/courses");
    expect(await screen.findByRole("link", { name: "Nederlands voor beginners" })).toBeVisible();
    expect(screen.getByText(/4 units · \d+% of the words known/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute(
      "href",
      "/courses/demo-course/1",
    );
  });

  it("shows unit status and runs Learn next for the unit's new cards", async () => {
    const learnNextForUnit = vi.fn(async () => ({ moved: 2, skipped: 4 }));
    const { user } = setup("/courses/demo-course/1", { learnNextForUnit });
    expect(
      await screen.findByRole("heading", { level: 1, name: "Thema 1 Kennismaken" }),
    ).toBeVisible();
    expect(screen.getByText("33% of the words known, 1 learning, 3 new.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Learn next (2)" }));
    expect(learnNextForUnit).toHaveBeenCalledWith("demo-course", 1);
    expect(await screen.findByText("2 words moved to the front in Anki")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add 1 missing words" })).toBeEnabled();
    // Words tab: each word with its Anki state
    await user.click(screen.getByRole("tab", { name: /Words/ }));
    expect(await screen.findByText("not in Anki")).toBeInTheDocument();
  });

  it("imports a book: upload, reading progress, outline editor with checks, decks, done", async () => {
    const { user, services } = setup("/courses/import");
    const importCourse = vi.spyOn(services, "importCourse");
    const file = new File(["%PDF-1.4"], "Mijn boek.pdf", { type: "application/pdf" });
    await user.upload(await screen.findByLabelText("Book file"), file);
    await user.click(screen.getByRole("button", { name: "Start reading the book" }));
    expect(importCourse).toHaveBeenCalledWith({ kind: "pdf", files: [file] }, expect.any(Function));

    const first = await screen.findByLabelText("Last page of unit 1");
    await user.clear(first);
    await user.type(first, "30");
    expect(await screen.findByText(/share page 21/)).toBeInTheDocument();
    const go = screen.getByRole("button", { name: "Continue" });
    expect(go).toBeDisabled();
    await user.clear(first);
    await user.type(first, "20");
    await waitFor(() => expect(go).toBeEnabled());
    await user.click(go);

    expect(await screen.findByText(/Match each unit to the Anki decks/)).toBeInTheDocument();
    expect(screen.getByText("Nederlands voor beginners::Thema 2 - Winkelen")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Find the exercises" }));
    expect(await screen.findByText("The course is ready.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the course" })).toHaveAttribute(
      "href",
      "/courses/demo-course",
    );
  });
});
