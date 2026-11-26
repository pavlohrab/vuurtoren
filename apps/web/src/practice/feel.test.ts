import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_FEEL, readFeel, writeFeel } from "./feel.js";

afterEach(() => localStorage.clear());

describe("how Practice reacts", () => {
  it("is all on by default except the buzz", () => {
    expect(readFeel()).toEqual(DEFAULT_FEEL);
    expect(DEFAULT_FEEL).toMatchObject({
      sayDutch: true,
      sounds: true,
      movement: true,
      sayOnCard: true,
      vibrate: false,
    });
  });

  it("remembers a change and ignores what isn't a setting", () => {
    writeFeel({ ...DEFAULT_FEEL, sounds: false });
    expect(readFeel().sounds).toBe(false);
    localStorage.setItem("vuurtoren.practice.feel", JSON.stringify({ sounds: "loud", bogus: 1 }));
    expect(readFeel()).toEqual(DEFAULT_FEEL);
  });
});
