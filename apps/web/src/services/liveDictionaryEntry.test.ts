import type { VuurtorenRepository } from "@app/db";
import type { EntryResult, NlpClient } from "@app/nlp-client";
import { describe, expect, it, vi } from "vitest";
import { createLiveDictionary } from "./liveDictionary.js";

const OPENDOEN: EntryResult = {
  word: "opendoen",
  entries: [{ pos: "verb", article: null, glosses: ["to open"], base: "doen" }],
};

function setup(local: EntryResult | null, server: () => Promise<EntryResult>) {
  const entry = vi.fn(server);
  const dictionary = createLiveDictionary({
    repo: {} as VuurtorenRepository,
    lang: async () => "nl",
    nlp: async () => ({ entry }) as unknown as NlpClient,
    localEntry: async () => local,
  });
  return { dictionary, entry };
}

describe("the word card's entry", () => {
  it("comes from the pack on the device first, without asking the server", async () => {
    const { dictionary, entry } = setup(OPENDOEN, async () => OPENDOEN);
    expect(await dictionary.entry("doet")).toEqual(OPENDOEN);
    expect(entry).not.toHaveBeenCalled();
  });

  it("asks the language server when the pack has nothing", async () => {
    const { dictionary, entry } = setup(null, async () => OPENDOEN);
    expect(await dictionary.entry("opendoen", "verb")).toEqual(OPENDOEN);
    expect(entry).toHaveBeenCalledWith("nl", "opendoen", "verb");
  });

  it("is null when neither can answer", async () => {
    const { dictionary } = setup(null, async () => {
      throw new Error("no server");
    });
    expect(await dictionary.entry("opendoen")).toBeNull();
  });
});
