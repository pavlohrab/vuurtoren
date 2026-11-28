import { describe, expect, it } from "vitest";
import type { AIProvider } from "./types.js";
import { checkUse } from "./useCheck.js";

const answering = (text: string) =>
  ({
    config: { provider: "test", model: "m", baseUrl: "" },
    chat: async () => ({ text }),
  }) as unknown as AIProvider;

describe("checkUse", () => {
  it("reads a right answer without extras", async () => {
    expect(
      await checkUse(answering('{"verdict":"right","better":"x"}'), {
        word: "fiets",
        sentence: "Ik fiets.",
      }),
    ).toEqual({ verdict: "right" });
  });
  it("reads an almost with the better sentence and why", async () => {
    const r = await checkUse(
      answering('{"verdict":"almost","better":"Gisteren ging ik.","why":"The verb goes second."}'),
      { word: "fiets", sentence: "Gisteren ik ging." },
    );
    expect(r).toEqual({
      verdict: "almost",
      better: "Gisteren ging ik.",
      why: "The verb goes second.",
    });
  });
  it("says so when the answer can't be read", async () => {
    await expect(checkUse(answering("no json"), { word: "x", sentence: "y" })).rejects.toThrow(
      /could not be read/,
    );
  });
});
