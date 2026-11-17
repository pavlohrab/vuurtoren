import { createMemoryHistory } from "@tanstack/react-router";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App, type AppProps } from "./App.js";
import { createMockServices } from "./services/mock.js";
import type { AppServices } from "./services/types.js";

function setup(
  path: string,
  wrap?: (s: AppServices) => AppServices,
  props: Partial<AppProps> = {},
) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const base = createMockServices({ latencyMs: 0 });
  const services = wrap ? wrap(base) : base;
  render(<App services={services} history={history} {...props} />);
  return { history, services };
}

describe("ReaderPage", () => {
  it("starts a different text from its own beginning, with no selection", async () => {
    const { history } = setup("/read/t-utrecht");
    await userEvent.click(await screen.findByRole("button", { name: "Next segment" }));
    expect(await screen.findByText("Segment 2 of 2")).toBeInTheDocument();
    await userEvent.click(await screen.findByText("trein"));
    await act(async () => history.push("/read/t-markt"));
    expect(await screen.findByText("Segment 1 of 2")).toBeInTheDocument();
    expect(screen.getByText(/Select a word in the text/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add to Anki" })).toBeNull();
  });

  it("does not offer actions for the previous word while the next one loads", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    setup("/read/t-utrecht", (s) => ({
      ...s,
      inspect: async (textId, i) => {
        const entry = await s.inspect(textId, i);
        if (entry.surface === "stad") await gate;
        return entry;
      },
    }));
    await userEvent.click(await screen.findByText("zus"));
    expect(await screen.findByRole("button", { name: "In Anki" })).toBeInTheDocument();
    await userEvent.click(screen.getByText("stad"));
    expect(await screen.findByText("Loading the word")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark known" })).toBeNull();
    await act(async () => release());
    expect(await screen.findByRole("heading", { name: /stad/ })).toBeInTheDocument();
  });

  it("shows the real error and a Retry button when the text fails to load", async () => {
    let fail = true;
    setup("/read/t-utrecht", (s) => ({
      ...s,
      getReading: async (id) => {
        if (fail) throw new Error("The database is locked");
        return s.getReading(id);
      },
    }));
    expect(await screen.findByText("The database is locked")).toBeInTheDocument();
    expect(screen.queryByText("This text was not found")).toBeNull();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Segment 1 of 2")).toBeInTheDocument();
  });

  it("submits a segment once, and resumes at the next one", async () => {
    const finish = vi.fn();
    const { history } = setup("/read/t-utrecht", (s) => ({
      ...s,
      finishSegment: async (...args) => {
        finish(...args);
        return s.finishSegment(...args);
      },
    }));
    await userEvent.click(await screen.findByRole("button", { name: "Next segment" }));
    await userEvent.click(await screen.findByRole("button", { name: "Previous" }));
    expect(await screen.findByText("Segment 1 of 2")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next segment" }));
    expect(await screen.findByText("Segment 2 of 2")).toBeInTheDocument();
    expect(finish).toHaveBeenCalledTimes(1);
    expect(finish.mock.calls[0]?.[1]).toBe(0);

    // Leaving and coming back resumes at the segment after the finished one.
    await act(async () => history.push("/library"));
    await screen.findByText("Op de markt");
    await act(async () => history.push("/read/t-utrecht"));
    expect(await screen.findByText("Segment 2 of 2")).toBeInTheDocument();
  });

  it("counts unanswered blanks as answered with no credit", async () => {
    const finish = vi.fn();
    setup("/read/t-utrecht", (s) => ({
      ...s,
      finishSegment: async (...args) => {
        finish(...args);
        return s.finishSegment(...args);
      },
    }));
    await userEvent.click(await screen.findByRole("tab", { name: "Cloze" }));
    await userEvent.click(await screen.findByRole("button", { name: "Show answers" }));
    await userEvent.click(screen.getByRole("button", { name: "Next segment" }));
    await waitFor(() => expect(finish).toHaveBeenCalled());
    expect(finish.mock.calls[0]?.[2]).toMatchObject({ clozeAccuracy: 0 });
  });

  it("toasts the reason when saving progress fails", async () => {
    setup("/read/t-utrecht", (s) => ({
      ...s,
      finishSegment: async () => {
        throw new Error("Disk is full");
      },
    }));
    await userEvent.click(await screen.findByRole("button", { name: "Next segment" }));
    expect(await screen.findByText("Disk is full")).toBeInTheDocument();
    expect(screen.getByText("Segment 1 of 2")).toBeInTheDocument();
  });

  it("leaves arrow keys to focused buttons", async () => {
    setup("/read/t-utrecht");
    const next = await screen.findByRole("button", { name: "Next segment" });
    next.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(next).toHaveFocus();
  });
});

describe("AppShell notices", () => {
  it("shows the storage notice and the demo chip with a way out", async () => {
    const onLeaveDemo = vi.fn();
    setup("/library", undefined, {
      notice: "Data will not be saved here.",
      demo: true,
      onLeaveDemo,
    });
    expect(await screen.findByText("Data will not be saved here.")).toBeInTheDocument();
    expect(screen.getByText("Demo data")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Use my data" }));
    expect(onLeaveDemo).toHaveBeenCalled();
  });

  it("shows no banner by default", async () => {
    setup("/library");
    await screen.findByText("Een dag in Utrecht");
    expect(screen.queryByText("Demo data")).toBeNull();
  });
});
