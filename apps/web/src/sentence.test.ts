import { describe, expect, it } from "vitest";
import { sentenceWith } from "./sentence.js";

describe("sentenceWith", () => {
  it("finds the sentence with the word, as a whole word, ignoring case", () => {
    const text = "Hoi! Drink je graag koffie? Ik drink thee.";
    expect(sentenceWith(text, "koffie")).toBe("Drink je graag koffie?");
    expect(sentenceWith(text, "Drink")).toBe("Drink je graag koffie?");
    expect(sentenceWith(text, "thee")).toBe("Ik drink thee.");
    // "rink" is not a word of the text: the whole text.
    expect(sentenceWith(text, "rink")).toBe(text);
  });
});
