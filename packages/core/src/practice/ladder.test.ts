import { describe, expect, it } from "vitest";
import { checkAnswer } from "./check.js";
import { STEP_OF, maxStep } from "./choose.js";
import { generate } from "./generate.js";
import { createRng } from "./rng.js";
import { word } from "./testutil.js";

describe("the ladder's top: write it, use it", () => {
  const fiets = word("fiets", { article: "de", glosses: ["bike"] });

  it("write: the English, the Dutch with its article", () => {
    const ex = generate("write", fiets, [], createRng(1))!;
    expect(ex).toMatchObject({
      kind: "write",
      skill: "recall",
      prompt: { text: "bike" },
      answer: "de fiets",
    });
    expect(STEP_OF.write).toBe(5);
  });

  it("write: without the article or with the other one it counts, with the right one as a note", () => {
    const ex = generate("write", fiets, [], createRng(1))!;
    expect(checkAnswer(ex, "de fiets")).toEqual({ correct: true });
    expect(checkAnswer(ex, "fiets")).toEqual({ correct: true, note: "With its article: de fiets" });
    expect(checkAnswer(ex, "het fiets")).toEqual({
      correct: true,
      note: "With its article: de fiets",
    });
    expect(checkAnswer(ex, "fietsen")).toEqual({ correct: false });
  });

  it("use is step 6, and a word can reach it", () => {
    expect(STEP_OF.use).toBe(6);
    expect(maxStep({ hardest: 5, hasCard: true, state: "learning" })).toBe(6);
    expect(generate("use", fiets, [], createRng(1))).toMatchObject({
      prompt: { text: "de fiets", hint: "bike" },
    });
  });
});
