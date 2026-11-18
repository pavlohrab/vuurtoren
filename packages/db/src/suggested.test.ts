import { describe, expect, it } from "vitest";
import { createRepository } from "./repository.js";
import { createNodeDriver } from "./node.js";

describe("suggestedWords", () => {
  it("queues suggestions, newest first, and drops dismissed ones", async () => {
    const repo = await createRepository(await createNodeDriver());
    const suggest = (key: string, gloss?: string) =>
      repo.append({
        type: "WordSuggested",
        lang: "nl",
        key,
        word: key,
        by: "claude-code",
        ...(gloss ? { gloss } : {}),
      });
    await suggest("fiets", "bike");
    await suggest("weg");
    await suggest("fiets", "bicycle");
    await repo.append({ type: "WordSuggestionDismissed", lang: "nl", key: "weg" });
    const open = await repo.suggestedWords("nl");
    expect(open.map((s) => [s.key, s.gloss])).toEqual([["fiets", "bicycle"]]);
    expect(await repo.suggestedWords("de")).toEqual([]);
    await suggest("weg");
    expect((await repo.suggestedWords("nl")).map((s) => s.key)).toEqual(["weg", "fiets"]);
  });
});
