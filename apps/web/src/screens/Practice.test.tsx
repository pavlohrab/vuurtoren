import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Exercise } from "@app/core";
import { App } from "../App.js";
import { MOCK_EXERCISES } from "../services/mockPractice.js";
import { readStartOptions } from "./Practice.js";
import { createMockServices } from "../services/mock.js";
import type { AppServices } from "../services/types.js";

function setup(exercises: Exercise[] = MOCK_EXERCISES, path = "/practice") {
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
  const history = createMemoryHistory({ initialEntries: [path] });
  render(<App services={services} history={history} />);
  return { services, answers, history, user: userEvent.setup() };
}

const START = /^Start/;

async function begin(user: ReturnType<typeof userEvent.setup>) {
  const start = await screen.findByRole("button", { name: START });
  await waitFor(() => expect(start).toBeEnabled());
  await user.click(start);
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
  localStorage.clear();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "speechSynthesis");
});

describe("Practice start view", () => {
  it("shows the overview, keeps one skill selected and starts with the chosen options", async () => {
    stubSpeech([{ lang: "nl-NL" }]);
    const { services, user } = setup();
    await waitFor(() => expect(screen.getByRole("button", { name: "Listening" })).toBeEnabled());
    expect(await screen.findByText(/^\d+ due · \d+ new$/)).toBeInTheDocument();
    expect(screen.getByText(/Practice trains what Anki doesn.t/)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /^Start · \d+ due$/ })).toBeInTheDocument();
    await user.click(screen.getByText("Options"));
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
    await user.click(screen.getByRole("button", { name: "5 words" }));
    await begin(user);
    await waitFor(() =>
      expect(services.startPractice).toHaveBeenCalledWith({
        size: 5,
        skills: ["recognition", "gender"],
        aiSentences: true,
      }),
    );
  });

  it("?start=1 starts at once with the remembered options, then drops the flag", async () => {
    const { services, history } = setup(MOCK_EXERCISES, "/practice?start=1");
    await waitFor(() => expect(services.startPractice).toHaveBeenCalledTimes(1));
    expect(vi.mocked(services.startPractice).mock.calls[0]![0]).toMatchObject({
      size: readStartOptions().size,
    });
    await waitFor(() => expect(history.location.search).not.toContain("start"));
  });

  it("remembers the options for the next visit", async () => {
    stubSpeech([{ lang: "nl-NL" }]);
    const { user } = setup();
    await user.click(await screen.findByText("Options"));
    await user.click(screen.getByRole("button", { name: "15 words" }));
    await user.click(screen.getByRole("button", { name: "Listening" }));
    expect(readStartOptions()).toMatchObject({ size: 15 });
    expect(readStartOptions().skills).not.toContain("listening");
  });

  it("fills gaps with AI sentences when a provider is set, without a line about it in the session", async () => {
    stubSpeech([{ lang: "nl-NL" }]);
    const { services, user } = setup();
    const box = await screen.findByRole("checkbox", { name: /Fill gaps with AI sentences/ });
    expect(box).toBeChecked();
    await begin(user);
    await waitFor(() =>
      expect(services.startPractice).toHaveBeenCalledWith(
        expect.objectContaining({ aiSentences: true }),
      ),
    );
    expect(await screen.findByText(`1 of ${MOCK_EXERCISES.length}`)).toBeInTheDocument();
    expect(screen.queryByText(/AI sentences? for/)).not.toBeInTheDocument();
  });

  it("starts without AI sentences when the option is off", async () => {
    stubSpeech([{ lang: "nl-NL" }]);
    const { services, user } = setup();
    await user.click(await screen.findByRole("checkbox", { name: /Fill gaps with AI sentences/ }));
    await begin(user);
    await waitFor(() => expect(services.startPractice).toHaveBeenCalled());
    expect(vi.mocked(services.startPractice).mock.calls[0]![0]).not.toHaveProperty("aiSentences");
  });

  it("disables Listening without a Dutch voice and never asks for it", async () => {
    stubSpeech([{ lang: "en-US" }]);
    const { services, user } = setup();
    const chip = await screen.findByRole("button", { name: "Listening" });
    await waitFor(() => expect(chip).toHaveAttribute("aria-disabled", "true"));
    expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("note")).toHaveTextContent(/Add a Dutch voice/);
    await begin(user);
    await waitFor(() => expect(services.startPractice).toHaveBeenCalled());
    const call = vi.mocked(services.startPractice).mock.calls[0]![0]!;
    expect(call.skills).not.toContain("listening");
    expect(call.skills).toContain("recognition");
  });

  it("says so when the language server is unreachable", async () => {
    const base = createMockServices({ latencyMs: 0 });
    const services: AppServices = {
      ...base,
      practiceOverview: async () => ({ ...(await base.practiceOverview()), degraded: true }),
    };
    render(
      <App services={services} history={createMemoryHistory({ initialEntries: ["/practice"] })} />,
    );
    expect(
      await screen.findByText(
        "The language server doesn’t answer, so there are fewer kinds of exercise today.",
      ),
    ).toBeInTheDocument();
  });

  it("says so when there is nothing to practise", async () => {
    const { user } = setup([]);
    await begin(user);
    expect(await screen.findByText(/Nothing to practise yet/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("button", { name: START })).toBeInTheDocument();
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
      expect(await fed(/^Right$/)).toBeInTheDocument();
      await user.keyboard("{Enter}");
    }

    expect(
      await screen.findByText(`${MOCK_EXERCISES.length} of ${MOCK_EXERCISES.length} correct.`),
    ).toBeInTheDocument();
    expect(answers).toHaveLength(MOCK_EXERCISES.length);
    expect(screen.queryByText(/Words to look at again/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Practise again" }));
    // Everything was just practised: nothing is due or new, so there is no Start button.
    expect(await screen.findByRole("heading", { name: "All caught up" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: START })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Find something to read" })).toBeInTheDocument();
  });

  it("shows an empty state with one next step when there is nothing to practise", async () => {
    const base = createMockServices({ latencyMs: 0 });
    const services: AppServices = {
      ...base,
      practiceOverview: async () => ({
        due: 0,
        newAvailable: 0,
        learned: 0,
        bySkill: { recognition: 0, recall: 0, form: 0, gender: 0, listening: 0 },
        lastSession: null,
      }),
    };
    render(
      <App services={services} history={createMemoryHistory({ initialEntries: ["/practice"] })} />,
    );
    expect(
      await screen.findByRole("heading", { name: "Nothing to practise yet" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: START })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Find something to read" })).toBeInTheDocument();
  });

  it("uses 1-4 for choices, shows the right answer after a miss and lists words to review", async () => {
    const list = MOCK_EXERCISES.filter((e) => e.kind === "meaning-choice").slice(0, 1);
    const { answers, user } = setup(list);
    await begin(user);
    const wrong = list[0]!.choices!.findIndex((c) => c !== list[0]!.answer) + 1;
    await user.keyboard(String(wrong));
    expect(await fed(/^Not quite$/)).toBeInTheDocument();
    expect(screen.getByText(/Answer:/)).toHaveTextContent("canal");
    expect(answers[0]!.answer).toBe(list[0]!.choices![wrong - 1]);
    // choices are locked now
    await user.keyboard("1");
    expect(answers).toHaveLength(1);
    await user.keyboard("{Enter}");
    expect(await screen.findByText("0 of 1 correct.")).toBeInTheDocument();
    expect(screen.getByText("Words to look at again")).toBeInTheDocument();
    // A word to look at again opens the inspector here, not another page.
    await user.click(screen.getByRole("button", { name: "gracht" }));
    const panel = await screen.findByRole("complementary", { name: "Inspector" });
    await waitFor(() => expect(panel).toHaveTextContent(/gracht/));
    // Every next step leads somewhere: Words filtered to the misses, Talk seeded, a next text.
    const next = screen.getByRole("navigation", { name: "Next steps" });
    expect(within(next).getByRole("link", { name: /Review these words/ })).toHaveAttribute(
      "href",
      "/words/all?source=practice-again",
    );
    expect(within(next).getByRole("link", { name: /Talk about these words/ })).toHaveAttribute(
      "href",
      "/talk?words=gracht",
    );
    expect(
      await within(next).findByRole("link", { name: /Next text|Continue reading/ }),
    ).toHaveAttribute("href", expect.stringMatching(/^\/read\//));
    expect(JSON.parse(localStorage.getItem("vuurtoren-practice-again") ?? "[]")).toEqual([
      "gracht",
    ]);
  });

  it("practises only the words given in the URL", async () => {
    const base = createMockServices({ latencyMs: 0 });
    const calls: unknown[] = [];
    const services: AppServices = {
      ...base,
      startPractice: async (opts) => {
        calls.push(opts);
        return base.startPractice(opts);
      },
    };
    const user = userEvent.setup();
    render(
      <App
        services={services}
        history={createMemoryHistory({ initialEntries: ["/practice?words=gracht,brug"] })}
      />,
    );
    expect(await screen.findByRole("heading", { name: "Practise these words" })).toBeVisible();
    expect(screen.getByText("gracht, brug")).toBeInTheDocument();
    await begin(user);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ keys: ["gracht", "brug"] });
  });

  it("answers de or het with the keyboard", async () => {
    const list = MOCK_EXERCISES.filter((e) => e.kind === "gender");
    const { user } = setup(list);
    await begin(user);
    await user.keyboard("d"); // schuur: de
    expect(await fed(/^Right$/)).toBeInTheDocument();
    await user.keyboard("{Enter}");
    await user.keyboard("2"); // boek: het
    expect(await fed(/^Right$/)).toBeInTheDocument();
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
    expect(await fed(/^Right$/)).toBeInTheDocument();
    await user.keyboard("{Enter}");

    const words = await screen.findByRole("group", { name: "Words" });
    await user.click(within(words).getByRole("button", { name: "rood" }));
    await user.click(within(words).getByRole("button", { name: "is" }));
    await user.keyboard("{Backspace}");
    expect(within(words).getByRole("button", { name: "is" })).toBeEnabled();
    expect(within(words).getByRole("button", { name: "rood" })).toBeDisabled();
    // Hint: a wrong start is cleared, then each ? places the next right word.
    await user.keyboard("?");
    expect(within(words).getByRole("button", { name: "rood" })).toBeEnabled();
    await user.keyboard("?");
    expect(within(words).getByRole("button", { name: "De" })).toBeDisabled();
  });

  it("shows a new word, then a pairs warm-up, without grading either", async () => {
    const gender = MOCK_EXERCISES.find((e) => e.kind === "gender")!;
    const meet = {
      id: "meet-gracht",
      kind: "meet",
      skill: "recognition",
      key: "gracht",
      instruction: "New word",
      prompt: { text: "de gracht", hint: "canal", sentence: "Ze fietst langs de gracht." },
      answer: "de gracht",
    } as Exercise;
    const pairs = {
      id: "pairs-1",
      kind: "pairs",
      skill: "recognition",
      key: "brug",
      instruction: "Tap the pairs",
      prompt: { text: "" },
      pairs: [
        { nl: "de brug", en: "bridge" },
        { nl: "de sleutel", en: "key" },
        { nl: "de markt", en: "market" },
      ],
      answer: "",
    } as Exercise;
    const { answers, user } = setup([meet, pairs, gender]);
    await begin(user);
    expect(await screen.findByText("canal")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /Got it/ }));
    const dutch = await screen.findByRole("group", { name: "Dutch" });
    const meanings = screen.getByRole("group", { name: "Meanings" });
    for (const [nl, en] of [
      ["de brug", "bridge"],
      ["de sleutel", "key"],
      ["de markt", "market"],
    ] as const) {
      await user.click(within(dutch).getByRole("button", { name: nl }));
      await user.click(within(meanings).getByRole("button", { name: en }));
    }
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("group", { name: "Answers" })).toBeVisible();
    expect(answers).toHaveLength(0);
  });

  it("asks before ending with Escape once something was answered", async () => {
    const list = MOCK_EXERCISES.filter((e) => e.kind === "gender");
    const { user } = setup(list);
    await begin(user);
    await user.keyboard("{Escape}"); // nothing answered yet: ends straight away
    expect(await screen.findByText("No exercises were answered.")).toBeInTheDocument();
  });

  it("confirms Escape after an answer, then ends with the answer in the summary", async () => {
    const list = MOCK_EXERCISES.filter((e) => e.kind === "gender");
    const { user } = setup(list);
    await begin(user);
    await user.keyboard("d");
    expect(await fed(/^Right$/)).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("group", { name: "End the session?" })).toBeInTheDocument();
    expect(screen.queryByText("Lesson done")).not.toBeInTheDocument();
    await user.keyboard("{Escape}"); // dismisses the question
    expect(screen.queryByRole("group", { name: "End the session?" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(
      within(screen.getByRole("group", { name: "End the session?" })).getByRole("button", {
        name: "End session",
      }),
    );
    expect(await screen.findByText("1 of 1 correct.")).toBeInTheDocument();
  });

  it("waits for an answer that is still being saved before ending", async () => {
    const list = MOCK_EXERCISES.filter((e) => e.kind === "gender");
    const base = createMockServices({ latencyMs: 0 });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const services: AppServices = {
      ...base,
      startPractice: async () => list,
      answerExercise: async (e, a) => {
        await gate;
        return base.answerExercise(e, a);
      },
    };
    render(
      <App services={services} history={createMemoryHistory({ initialEntries: ["/practice"] })} />,
    );
    const user = userEvent.setup();
    await begin(user);
    await user.keyboard("d");
    await user.keyboard("{Escape}");
    await user.click(
      within(screen.getByRole("group", { name: "End the session?" })).getByRole("button", {
        name: "End session",
      }),
    );
    expect(screen.queryByText("Lesson done")).not.toBeInTheDocument();
    release();
    expect(await screen.findByText("1 of 1 correct.")).toBeInTheDocument();
  });

  it("ignores shortcuts while a dialog is open or another input has focus", async () => {
    const list = MOCK_EXERCISES.filter((e) => e.kind === "meaning-choice").slice(0, 1);
    const { answers, user } = setup(list);
    await begin(user);
    await screen.findByText("1 of 1");
    // a palette-like dialog with its own search input
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const input = document.createElement("input");
    dialog.append(input);
    document.body.append(dialog);
    input.focus();
    await user.keyboard("1{Escape}");
    expect(answers).toHaveLength(0);
    expect(screen.queryByText("Lesson done")).not.toBeInTheDocument();
    dialog.remove();
    // an editable element outside the card, no dialog role
    const search = document.createElement("input");
    document.body.append(search);
    search.focus();
    await user.keyboard("1");
    expect(answers).toHaveLength(0);
    search.remove();
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard("1");
    await waitFor(() => expect(answers).toHaveLength(1));
  });

  it("hints stop before the whole word; the last step gives up and counts as wrong", async () => {
    const typed = MOCK_EXERCISES.find((e) => e.kind === "cloze-typed")!; // answer "brug"
    const { user } = setup([typed]);
    await begin(user);
    const input = await screen.findByLabelText("Your answer");
    await user.type(input, "???");
    expect(screen.getByText("bru…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show the answer" })).toBeInTheDocument();
    await user.type(input, "?");
    expect(await fed(/^Not quite$/)).toBeInTheDocument();
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
    // the dictation is skipped asynchronously: wait for the gender exercise before typing
    await screen.findByText("de or het?");
    await user.keyboard("d");
    expect(await fed(/^Right$/)).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(await screen.findByText(/1 listening exercise was skipped/)).toBeInTheDocument();
    expect(answers).toHaveLength(1);
  });
});
