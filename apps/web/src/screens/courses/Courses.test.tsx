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

  it("shows unit status and runs Study first in Anki for the unit's new cards", async () => {
    const learnNextForUnit = vi.fn(async () => ({ moved: 2, skipped: 4 }));
    const { user } = setup("/courses/demo-course/1", { learnNextForUnit });
    expect(
      await screen.findByRole("heading", { level: 1, name: "Thema 1 Kennismaken" }),
    ).toBeVisible();
    // The top bar names the unit (not "Courses") but is not a second h1.
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(document.querySelector(".topbar-title")).toHaveTextContent("Thema 1 Kennismaken");
    expect(document.querySelector(".topbar-crumb")).toHaveAttribute("href", "/courses/demo-course");
    expect(screen.getByText("33% of the words known, 1 learning, 3 new.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Study first in Anki (2)" }));
    expect(learnNextForUnit).toHaveBeenCalledWith("demo-course", 1);
    expect(await screen.findByText("2 words moved to the front in Anki")).toBeInTheDocument();
    // Words tab: each word with its Anki state, linked to the shared Words hub inspector
    await user.click(screen.getByRole("tab", { name: /Words/ }));
    expect(await screen.findByText("Not in Anki")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /stad/ }).getAttribute("href")).toContain("word=stad");
  });

  it("adds a unit's words to Anki from a preview with the book's sentence", async () => {
    const addUnitWords = vi.fn(async () => ({ added: 1, failed: 0, deck: "Kenning::Dutch" }));
    const { user } = setup("/courses/demo-course/1", { addUnitWords });
    await user.click(await screen.findByRole("button", { name: "Add 1 word to Anki…" }));
    const dialog = await screen.findByRole("dialog", { name: "Add this unit's words to Anki" });
    expect(await within(dialog).findByText("Anne woont in een kleine stad.")).toBeVisible();
    expect(
      within(dialog).getByText(/^1 new word · \d+ already in Anki · \d+ known$/),
    ).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: /^Add 1 to/ }));
    expect(addUnitWords).toHaveBeenCalledWith("demo-course", 1, { keys: ["stad"] });
    expect(await screen.findByText(/1 word added to/)).toBeInTheDocument();
  });

  it("links the unit's grammar to topic pages, practice to the shared screen, and shows exercises made for it", async () => {
    const { user } = setup("/courses/demo-course/1");
    expect(
      await screen.findByRole("heading", { name: "Made for this unit", level: 2 }),
    ).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "Grammar" }));
    expect(await screen.findByRole("link", { name: "Inversion" })).toHaveAttribute(
      "href",
      "/grammar/inversion",
    );
    await user.click(screen.getByRole("tab", { name: "Practice" }));
    const practise = await screen.findByRole("link", { name: "Practise this unit’s words" });
    expect(practise.getAttribute("href")).toMatch(/^\/practice\?words=/);
  });

  it("sets a unit boundary by clicking a page in the outline editor", async () => {
    const { user } = setup("/courses/demo-course/edit");
    const strip = await screen.findByRole("region", { name: "Pages of the book" });
    expect(screen.getAllByLabelText(/^Title of unit/)).toHaveLength(4);
    const page = within(strip).getAllByRole("listitem")[9]!;
    await user.click(within(page).getByRole("button", { name: "Start a unit here" }));
    expect(screen.getAllByLabelText(/^Title of unit/)).toHaveLength(5);
    expect(screen.getByLabelText("Last page of unit 1")).toHaveValue(9);
    expect(screen.getByLabelText("First page of unit 2")).toHaveValue(10);
    await user.click(screen.getByRole("button", { name: "Merge unit 2 into the one above" }));
    expect(screen.getAllByLabelText(/^Title of unit/)).toHaveLength(4);
  });

  it("offers to continue an import that was left", async () => {
    const resumeImport = vi.fn(async () => "demo-course");
    const { user } = setup("/courses/import", {
      pendingImport: async () => ({
        jobId: "j",
        title: "De Opmaat A2",
        filename: "opmaat.pdf",
        kind: "pdf" as const,
        lang: "nl",
        total: 289,
        startedAt: 0,
      }),
      resumeImport,
    });
    expect(await screen.findByText(/You started reading/)).toHaveTextContent("De Opmaat A2");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(resumeImport).toHaveBeenCalled();
    expect(await screen.findByRole("region", { name: "Pages of the book" })).toBeVisible();
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
