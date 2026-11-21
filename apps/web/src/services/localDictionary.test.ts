import { describe, expect, it, vi } from "vitest";
import type { VuurtorenRepository } from "@app/db";
import type { NlpClient } from "@app/nlp-client";
import { createLiveDictionary } from "./liveDictionary.js";

const repo = { wordsByKeys: async () => [] } as unknown as VuurtorenRepository;
const huis = [{ pos: "noun", article: "het", glosses: ["house"] }];
const koffiekopje = [{ pos: "noun", article: "het", glosses: ["coffee cup"], compound: true }];

function setup(local: Record<string, typeof huis> | null, server?: () => Promise<unknown>) {
  const gloss = vi.fn(server ?? (async () => ({ koffiekopje })));
  const nlp = async () => ({ gloss }) as unknown as NlpClient;
  const dict = createLiveDictionary({
    repo,
    lang: async () => "nl",
    nlp,
    localGloss: async () => (local ? { ...local } : null),
  });
  return { dict, gloss };
}

describe("the dictionary pack on the device", () => {
  it("answers first; the server only adds the words it does not know", async () => {
    const { dict, gloss } = setup({ huis, koffiekopje: [] });
    const found = await dict.dictionaryFor(["huis", "koffiekopje"]);
    expect(found["huis"]).toEqual(huis);
    expect(found["koffiekopje"]).toEqual(koffiekopje);
    expect(gloss).toHaveBeenCalledWith("nl", ["koffiekopje"]);
  });

  it("works without a server", async () => {
    const { dict } = setup({ huis }, async () => {
      throw new Error("offline");
    });
    const { found, complete } = await dict.lookupGlosses([{ key: "huis", lemma: "huis" }]);
    expect(found.get("huis")).toBe("house");
    expect(complete).toBe(true);
  });

  it("without the pack, asks the server as before", async () => {
    const { dict, gloss } = setup(null, async () => ({ huis }));
    expect((await dict.dictionaryFor(["huis"]))["huis"]).toEqual(huis);
    expect(gloss).toHaveBeenCalledWith("nl", ["huis"]);
  });
});
