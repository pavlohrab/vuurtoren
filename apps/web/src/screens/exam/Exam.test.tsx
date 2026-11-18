import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { examBank } from "@app/content";
import { App } from "../../App.js";
import { createMockServices } from "../../services/mock.js";
import type { AppServices } from "../../services/types.js";
import { examNextStep } from "../Home.js";

function setup(path: string, patch: Partial<AppServices> = {}) {
  const base = createMockServices({ latencyMs: 0 });
  const record = vi.fn(base.recordExamAttempt);
  const services: AppServices = { ...base, recordExamAttempt: record, ...patch };
  render(<App services={services} history={createMemoryHistory({ initialEntries: [path] })} />);
  return { user: userEvent.setup(), record, services };
}

const bank = examBank();

describe("Exam overview", () => {
  it("lists the five parts with official durations, the check date and official links", async () => {
    setup("/exam");
    const parts = (
      await screen.findAllByRole("link", { name: /Lezen|Luisteren|Schrijven|Spreken|KNM/ })
    ).filter((l) => l.getAttribute("href")?.startsWith("/exam/"));
    expect(parts.map((l) => l.getAttribute("href"))).toEqual([
      "/exam/lezen",
      "/exam/luisteren",
      "/exam/schrijven",
      "/exam/spreken",
      "/exam/knm",
    ]);
    expect(within(parts[0]!).getByText("65 min")).toBeInTheDocument();
    expect(within(parts[4]!).getByText("45 min")).toBeInTheDocument();
    expect(await screen.findAllByText("Not started")).toHaveLength(5);
    expect(screen.getByText(/Last checked 18 November 2026/)).toBeInTheDocument();
    const official = screen.getByRole("link", { name: /Official practice exams/ });
    expect(official).toHaveAttribute("href", "https://www.inburgeren.nl/examen-doen/oefenen.jsp");
    expect(official).toHaveAttribute("target", "_blank");
  });
});

describe("Multiple-choice sessions", () => {
  it("KNM practice: instant feedback with an explanation, then a recorded result", async () => {
    const { user, record } = setup("/exam/knm?mode=practice&theme=wonen");
    const theme = bank.knm.find((t) => t.id === "wonen")!;
    const q = theme.questions[0]!;
    await user.click(
      await screen.findByRole("radio", { name: new RegExp(escape(q.options[q.answer]!)) }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Right.");
    expect(screen.getByRole("status")).toHaveTextContent(q.explain);
    await user.click(screen.getByRole("button", { name: "Finish" }));
    expect(await screen.findByRole("heading", { name: "Your result" })).toBeInTheDocument();
    await waitFor(() =>
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({
          part: "knm",
          mode: "practice",
          setId: "theme:wonen",
          correct: 1,
          total: theme.questions.length,
        }),
      ),
    );
  });

  it("Lezen mock exam: timed, no feedback before handing in, words to learn after", async () => {
    const { user, record } = setup("/exam/lezen?mode=exam&set=1");
    expect(await screen.findByRole("timer")).toHaveTextContent(/1:0[45]:/);
    const text = bank.lezen.find((t) => t.set === 1)!;
    const q = text.questions[0]!;
    const wrong = q.options.find((_, i) => i !== q.answer)!;
    await user.click(screen.getByRole("radio", { name: new RegExp(escape(wrong)) }));
    expect(screen.queryByText("Not quite.")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Hand in \(1\/25\)/ }));
    expect(await screen.findByText("Not there yet")).toBeInTheDocument();
    expect(screen.getByText(/Pass mark about 18 questions of 25/)).toBeInTheDocument();
    const practise = screen.getByRole("link", { name: /Practise these/ });
    expect(practise.getAttribute("href")).toContain("words=");
    expect(practise.getAttribute("href")).toContain("aanvragen");
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        part: "lezen",
        mode: "exam",
        setId: "set:1",
        correct: 0,
        total: 25,
        passMark: 18,
      }),
    );
  });

  it("Luisteren: falls back to the transcript without a Dutch voice", async () => {
    setup("/exam/luisteren?mode=practice&set=1");
    expect(await screen.findByText(/no Dutch voice/)).toBeInTheDocument();
    expect(screen.getByText(bank.luisteren[0]!.lines[0]!.text)).toBeInTheDocument();
  });

  it("generates a new practice text when a provider is set", async () => {
    const { user } = setup("/exam/lezen");
    await user.click(await screen.findByRole("button", { name: /Generate a new practice text/ }));
    expect(await screen.findByText("AI practice text")).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Nieuwe openingstijden" })).toBeInTheDocument();
  });
});

describe("Writing and speaking", () => {
  it("Schrijven: write, check with the checklist and model answer, AI feedback, save", async () => {
    const task = bank.schrijven.tasks.find((t) => t.kind === "email")!;
    const { user, record } = setup(`/exam/schrijven?mode=practice&theme=${task.id}`);
    await user.type(
      await screen.findByLabelText("Your text"),
      "Beste meneer, ik komen morgen niet.",
    );
    await user.click(screen.getAllByRole("button", { name: "Check my answer" })[0]!);
    expect(screen.getByText("Model answer")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Check your answer" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Modal verbs" })).toHaveAttribute(
      "href",
      "/grammar/modal-verbs",
    );
    await user.click(screen.getByRole("button", { name: /Get AI feedback/ }));
    expect(await screen.findByLabelText("AI feedback")).toHaveTextContent("ik kom");
    await user.click(screen.getByRole("button", { name: /Save my score/ }));
    await waitFor(() =>
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({ part: "schrijven", setId: `task:${task.id}` }),
      ),
    );
  });

  it("Spreken: answer against the clock, then the model answer (no recording in tests)", async () => {
    const { user } = setup("/exam/spreken?mode=practice&set=1");
    const p = bank.spreken.prompts[0]!;
    expect(await screen.findByRole("heading", { name: p.question })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Start answering/ }));
    expect(screen.getByRole("timer")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /I'm done/ }));
    expect(await screen.findByText(p.model)).toBeInTheDocument();
    expect(screen.getByText("No recording for this answer.")).toBeInTheDocument();
  });
});

describe("Home exam step", () => {
  it("suggests the first untried part, then the weakest; null before starting", () => {
    const now = Date.UTC(2026, 10, 18, 12);
    const a = (part: string, correct: number, at = now - 2 * 86_400_000) => ({
      id: part,
      exam: "nl-a2",
      part,
      mode: "practice" as const,
      setId: "set:1",
      correct,
      total: 10,
      passMark: 7,
      durationMs: 1,
      at,
      missed: [],
      words: [],
    });
    expect(examNextStep([], now)).toBeNull();
    expect(examNextStep([a("lezen", 8)], now)).toMatchObject({
      part: "luisteren",
      label: "Try Luisteren",
      doneToday: 0,
    });
    const all = ["lezen", "luisteren", "schrijven", "spreken", "knm"].map((p, i) => a(p, 9 - i));
    expect(examNextStep(all, now)).toMatchObject({ part: "knm", label: "Practise KNM" });
    expect(examNextStep([...all, a("knm", 9, now)], now)).toMatchObject({
      part: "spreken",
      doneToday: 1,
    });
  });
});

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
