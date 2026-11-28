import { describe, expect, it } from "vitest";
import { PASSPHRASE_WORDS, makePassphrase } from "./passphrase.js";

describe("a passphrase that is easy to remember", () => {
  it("is three short words from the list, with dashes", () => {
    const p = makePassphrase();
    expect(p).toMatch(/^[a-z]+(-[a-z]+){2}$/);
    expect(PASSPHRASE_WORDS).toBe(1295);
  });

  it("uses the random numbers it is given", () => {
    expect(makePassphrase(3, () => 0)).toBe("acid-acid-acid");
  });
});
