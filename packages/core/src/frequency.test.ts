import { describe, expect, it } from "vitest";
import { frequencyLabel } from "./frequency.js";

describe("frequencyLabel (LV9)", () => {
  it("names how common a word is from its Zipf frequency", () => {
    expect(frequencyLabel(6.2)).toBe("very common"); // huis
    expect(frequencyLabel(4.4)).toBe("common");
    expect(frequencyLabel(3.1)).toBe("less common");
    expect(frequencyLabel(2.2)).toBe("rare");
  });
  it("says nothing for a word wordfreq doesn't know", () => {
    expect(frequencyLabel(0)).toBeNull();
    expect(frequencyLabel(undefined)).toBeNull();
  });
});
