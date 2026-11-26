import { describe, expect, it } from "vitest";
import { checkAnswer, heardWords } from "./check.js";
import { generate } from "./generate.js";
import { buildLesson } from "./lesson.js";
import { createRng } from "./rng.js";
import { sentence, word } from "./testutil.js";

const gracht = word("gracht", {
  state: "known",
  pKnown: 0.97,
  sentences: [
    sentence("Ze fietst langs de gracht.", "gracht", {
      translation: "She cycles along the canal.",
      unknown: 0,
    }),
  ],
});

describe("saying a sentence (algorithms.md 4.7)", () => {
  it("asks you to say a short sentence that has its English", () => {
    const ex = generate("say", gracht, [], createRng(1))!;
    expect(ex.instruction).toBe("Say this sentence");
    expect(ex.answer).toBe("Ze fietst langs de gracht.");
    expect(ex.prompt.translation).toBe("She cycles along the canal.");
    expect(
      generate(
        "say",
        word("x", { sentences: [sentence("Ze fietst langs de x.", "x")] }),
        [],
        createRng(1),
      ),
    ).toBeNull();
  });

  it("counts what came through, forgiving one letter in longer words", () => {
    expect(heardWords("Ze fietst langs de gracht.", "Ze fiets langs de geracht")).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(heardWords("Ik bel hem morgen op.", "Ik ben een morgoop")).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it("is right when most of the sentence was heard, and says what was heard otherwise", () => {
    const ex = generate("say", gracht, [], createRng(1))!;
    expect(checkAnswer(ex, "ze fietst langs de gracht").correct).toBe(true);
    expect(checkAnswer(ex, "Ze fiets langs de kracht")).toEqual({ correct: true });
    expect(checkAnswer(ex, "Ze fietst langs de deur")).toEqual({
      correct: true,
      note: "Heard: Ze fietst langs de deur",
    });
    expect(checkAnswer(ex, "zeven")).toMatchObject({ correct: false, note: "Heard: zeven" });
    expect(checkAnswer(ex, "").correct).toBe(false);
  });

  it("only comes into a lesson when the language server can listen", () => {
    const input = {
      words: [gracht],
      signals: [],
      states: [],
      answers: [],
      now: 1_800_000_000_000,
    };
    const kinds = (speaking: boolean) =>
      buildLesson({ ...input, speaking, only: new Set(["gracht"]) }, createRng(2)).map(
        (e) => e.kind,
      );
    expect(kinds(false)).not.toContain("say");
  });
});
