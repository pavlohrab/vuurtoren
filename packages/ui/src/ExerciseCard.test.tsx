import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Exercise } from "@app/core";
import { ExerciseCard } from "./ExerciseCard.js";

const cloze: Exercise = {
  id: "e1",
  kind: "cloze-typed",
  skill: "recall",
  key: "brug",
  instruction: "Type the missing word",
  prompt: {
    text: "Wij lopen over de ____ naar het station.",
    sentence: "Wij lopen over de brug naar het station.",
  },
  answer: "brug",
} as Exercise;

describe("ExerciseCard feedback", () => {
  it("opens a word of the answer or the sentence, and Enter on a word does not move on", () => {
    const onWord = vi.fn();
    const onContinue = vi.fn();
    render(
      <ExerciseCard
        exercise={cloze}
        feedback={{ correct: false }}
        submitted="brog"
        onSubmit={() => {}}
        onContinue={onContinue}
        onWord={onWord}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "station" }));
    expect(onWord).toHaveBeenCalledWith("station", cloze.prompt.sentence, expect.any(HTMLElement));

    const lopen = screen.getByRole("button", { name: "lopen" });
    lopen.focus();
    fireEvent.keyDown(lopen, { key: "Enter" });
    expect(onWord).toHaveBeenLastCalledWith("lopen", cloze.prompt.sentence, lopen);
    expect(onContinue).not.toHaveBeenCalled();

    // Enter elsewhere continues, as before.
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("keeps plain text without onWord", () => {
    render(
      <ExerciseCard
        exercise={cloze}
        feedback={{ correct: false }}
        onSubmit={() => {}}
        onContinue={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: "station" })).toBeNull();
  });
});
