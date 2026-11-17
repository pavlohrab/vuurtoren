import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Exercise } from "@app/core";
import { App } from "../App.js";
import { MOCK_EXERCISES } from "../services/mockPractice.js";
import { createMockServices } from "../services/mock.js";
import type { AppServices } from "../services/types.js";

function setup(exercises: Exercise[] = MOCK_EXERCISES) {
  const base = createMockServices({ latencyMs: 0 });
  const answers: { id: string; answer: string }[] = [];
  const services: AppServices = {
    ...base,
    startPractice: vi.fn(async () => exercises),
    answerExercise: async (exercise, attempt) => {
      answers.push({ id: exercise.id, answer: attempt.answer });
      return base.answerExercise(exercise, attempt);
    },
  };
  const history = createMemoryHistory({ initialEntries: ["/practice"] });
  render(<App services={services} history={history} />);
  return { services, answers, user: userEvent.setup() };
}

async function begin(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Start" }));
}
const fed = (re: RegExp) => screen.findByText(re);

function stubSpeech(voices: { lang: string }[]) {
  const speak = vi.fn();
  vi.stubGlobal(
    "SpeechSynthesisUtterance",
    class {
      constructor(public text: string) {}
    },
  );
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: { getVoices: () => voices, speak, cancel: vi.fn() },
  });
  return speak;
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "speechSynthesis");
});

describe("Practice start view", () => {
  it("shows the overview, keeps one skill selected and starts with the chosen options", async () => {
    const { services, user } = setup();
    expect(await screen.findByText(/\d+ due · \d+ new/)).toBeInTheDocument();
    const chips = ["Recognition", "Recall", "Forms", "Gender", "Listening"];
    for (const c of chips)
      expect(screen.getByRole("button", { name: c })).toHaveAttribute("aria-pressed", "true");
    for (const c of chips.slice(1)) await user.click(screen.getByRole("button", { name: c }));
    // the last selected skill cannot be switched off
    await user.click(screen.getByRole("button", { name: "Recognition" }));
    expect(screen.getByRole("button", { name: "Recognition" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Gender" }));
    await user.click(screen.getByRole("button", { name: "10 exercises" }));
    await begin(user);
    await waitFor(() =>
      expect(services.startPractice).toHaveBeenCalledWith({
        size: 10,
        skills: ["recognition", "gender"],
      }),
    );
  });

  it("says so when there is nothing to practise", async () => {
    const { user } = setup([]);
    await begin(user);
    expect(await screen.findByText(/Nothing to practise yet/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("button", { name: "Start" })).toBeInTheDocument();
  });
});

describe("Practice session", () => {
  it("goes through every kind of exercise to the summary", async () => {
    stubSpeech([{ lang: "nl-NL" }]);
    const { answers, user } = setup();
    await begin(user);

    for (const [i, e] of MOCK_EXERCISES.entries()) {
      expect(await screen.findByText(`${i + 1} of ${MOCK_EXERCISES.length}`)).toBeInTheDocument();
      expect(screen.getByText(e.instruction)).toBeInTheDocument();
      if (e.pieces) {
        // the pieces carry no final full stop in the mock ("rood"), the answer does
        for (const w of e.answer.replace(/\.$/, "").split(" ")) {
          const group = screen.getByRole("group", { name: "Words" });
          await user.click(within(group).getByRole("button", { name: w, hidden: false }));
        }
        await user.keyboard("{Enter}");
      } else if (e.choices) {
        await user.click(
          within(screen.getByRole("group", { name: "Answers" })).getByRole("button", {
            name: new RegExp(`${e.answer.replace(".", "\\.")}$`),
          }),
        );
      } else {
        await user.type(screen.getByLabelText("Your answer"), `${e.answer}{Enter}`);
      }
      expect(await fed(/Correct\./)).toBeInTheDocument();
      await user.keyboard("{Enter}");
    }

    expect(
      await screen.findByText(`${MOCK_EXERCISES.length} of ${MOCK_EXERCISES.length} correct.`),
    ).toBeInTheDocument();
    expect(answers).toHaveLength(MOCK_EXERCISES.length);
    expect(screen.queryByText(/Words to look at again/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Practice again" }));
    expect(await screen.findByRole("button", { name: "Start" })).toBeInTheDocument();
  });

  it("uses 1-4 for choices, shows the right answer after a miss and lists words to review", async () => {
    const list = MOCK_EXERCISES.filter((e) => e.kind === "meaning-choice").slice(0, 1);
    const { answers, user } = setup(list);
    await begin(user);
    const wrong = list[0]!.choices!.findIndex((c) => c !== list[0]!.answer) + 1;
    await user.keyboard(String(wrong));
    expect(await fed(/Not quite\./)).toBeInTheDocument();
    expect(screen.getByText(/Answer:/)).toHaveTextContent("canal");
    expect(answers[0]!.answer).toBe(list[0]!.choices![wrong - 1]);
    // choices are locked now
    await user.keyboard("1");
    expect(answers).toHaveLength(1);
    await user.keyboard("{Enter}");
    expect(await screen.findByText("0 of 1 correct.")).toBeInTheDocument();
    expect(screen.getByText("Words to look at again")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "gracht" })).toBeInTheDocument();
  });

  it("answers de or het with the keyboard", async () => {
    const list = MOCK_EXERCISES.filter((e) => e.kind === "gender");
    const { user } = setup(list);
    await begin(user);
    await user.keyboard("d"); // schuur: de
    expect(await fed(/Correct\./)).toBeInTheDocument();
    await user.keyboard("{Enter}");
    await user.keyboard("2"); // boek: het
    expect(await fed(/Correct\./)).toBeInTheDocument();
  });

  it("reveals letters of a typed answer with ? and undoes scramble pieces with Backspace", async () => {
    const typed = MOCK_EXERCISES.find((e) => e.kind === "cloze-typed")!;
    const scramble = MOCK_EXERCISES.find((e) => e.kind === "scramble")!;
    const { user } = setup([typed, scramble]);
    await begin(user);
    const input = await screen.findByLabelText("Your answer");
    await user.type(input, "?");
    expect(input).toHaveValue("");
    expect(screen.getByText("b…")).toBeInTheDocument();
    await user.type(input, "brug{Enter}");
    expect(await fed(/Correct\./)).toBeInTheDocument();
    await user.keyboard("{Enter}");

    const words = await screen.findByRole("group", { name: "Words" });
    await user.click(within(words).getByRole("button", { name: "rood" }));
    await user.click(within(words).getByRole("button", { name: "is" }));
    await user.keyboard("{Backspace}");
    expect(within(words).getByRole("button", { name: "is" })).toBeEnabled();
    expect(within(words).getByRole("button", { name: "rood" })).toBeDisabled();
  });

  it("ends early with Escape and shows what was answered", async () => {
    const list = MOCK_EXERCISES.filter((e) => e.kind === "gender");
    const { user } = setup(list);
    await begin(user);
    await user.keyboard("d");
    expect(await fed(/Correct\./)).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(await screen.findByText("1 of 1 correct.")).toBeInTheDocument();
  });

  it("plays dictation with a Dutch voice", async () => {
    const speak = stubSpeech([{ lang: "en-US" }, { lang: "nl-BE" }]);
    const list = MOCK_EXERCISES.filter((e) => e.kind === "dictation");
    const { user } = setup(list);
    await begin(user);
    await user.click(await screen.findByRole("button", { name: "Play audio" }));
    expect(speak).toHaveBeenCalled();
    expect(speak.mock.calls[0]![0]).toMatchObject({ text: "het huis" });
  });

  it("skips dictation without a Dutch voice and says so", async () => {
    const list = [
      ...MOCK_EXERCISES.filter((e) => e.kind === "dictation"),
      ...MOCK_EXERCISES.filter((e) => e.kind === "gender").slice(0, 1),
    ];
    const { answers, user } = setup(list);
    await begin(user);
    await user.keyboard("d");
    expect(await fed(/Correct\./)).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(await screen.findByText(/1 listening exercise was skipped/)).toBeInTheDocument();
    expect(answers).toHaveLength(1);
  });
});
