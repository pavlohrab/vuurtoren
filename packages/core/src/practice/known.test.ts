import { describe, expect, it } from "vitest";
import { formsOf, unknownOthers } from "./known.js";

describe("unknown words in a sentence (4.7.4)", () => {
  const model = new Set(["fiets", "deur", "lopen"]);
  const known = (f: string) => model.has(f);

  it("tries a form as written and with common endings off", () => {
    expect(formsOf("fietsen")).toEqual(expect.arrayContaining(["fietsen", "fiets"]));
    expect(formsOf("loopt")).toEqual(expect.arrayContaining(["lopen"]));
    expect(formsOf("zit")).toEqual(["zit"]); // too short to strip
    expect(formsOf("zitten")).toEqual(expect.arrayContaining(["zit"]));
  });

  it("counts other words the learner doesn't know, skipping small words and the target", () => {
    const text = "De fiets loopt bij de deur.";
    expect(unknownOthers(text, [3, 8], known)).toBe(0);
    expect(unknownOthers("De fiets loopt bij de gracht.", [3, 8], known)).toBe(1);
    // The target itself never counts, even when unknown.
    expect(unknownOthers("De gracht is mooi.", [3, 9], (f) => f === "mooi")).toBe(0);
  });
});
