import { describe, expect, it } from "vitest";
import { coverLine, storyHue } from "./coverLine.js";

describe("coverLine", () => {
  it("says the level and the new words, or what there is of them", () => {
    expect(coverLine("A2", 12)).toBe("about A2 · 12 new words");
    expect(coverLine("A2", 0)).toBe("about A2");
    expect(coverLine(null, 1)).toBe("1 new word");
    expect(coverLine(undefined, null)).toBeNull();
  });
  it("gives a story the same colour every time", () => {
    expect(storyHue("de-koe-op-de-toren")).toBe(storyHue("de-koe-op-de-toren"));
    expect(storyHue("x")).toMatch(/^var\(--pair-hue-[1-8]\)$/);
  });
});
