import { describe, expect, it } from "vitest";
import { createNodeDriver } from "./node.js";
import { createRepository } from "./repository.js";

describe("AI-generated sentences and AI texts", () => {
  it("fold SentencesGenerated per (lang, key, topic), dedupe, survive rebuild", async () => {
    const repo = await createRepository(await createNodeDriver());
    const base = { type: "SentencesGenerated" as const, provider: "anthropic", model: "m" };
    await repo.append({
      ...base,
      lang: "nl",
      key: "fiets",
      sentences: [{ text: "Ik heb een fiets.", translation: "I have a bike.", target: [11, 16] }],
      rejected: 2,
    });
    await repo.append({
      ...base,
      lang: "nl",
      key: "fiets",
      sentences: [{ text: "Ik heb een fiets." }, { text: "De fiets is rood." }],
    });
    await repo.append({ ...base, lang: "nl", key: "", topic: "inversion", sentences: [] });
    await repo.append({ ...base, lang: "de", key: "fiets", sentences: [{ text: "x" }] });
    const check = async () => {
      const sets = await repo.generatedSentences("nl");
      expect(sets).toHaveLength(2);
      expect(sets[0]).toMatchObject({ key: "fiets", rejected: 2, provider: "anthropic" });
      expect(sets[0]!.sentences.map((s) => s.text)).toEqual([
        "Ik heb een fiets.",
        "De fiets is rood.",
      ]);
      expect(sets[0]!.sentences[0]!.target).toEqual([11, 16]);
      expect(sets[1]).toMatchObject({ key: "", topic: "inversion", sentences: [] });
    };
    await check();
    await repo.rebuild();
    await check();
  });

  it("store AI stories as texts with source kind ai (old kinds unchanged)", async () => {
    const repo = await createRepository(await createNodeDriver());
    await repo.append({
      type: "TextImported",
      textId: "t1",
      title: "Op de markt",
      lang: "nl",
      source: {
        kind: "ai",
        provider: "anthropic",
        model: "m",
        targets: ["kraam"],
        topic: "markt",
        grammarTopic: "inversion",
      },
      content: "Op zaterdag ga ik naar de markt.",
    });
    await repo.append({
      type: "TextImported",
      textId: "t2",
      title: "Old",
      lang: "nl",
      source: { kind: "paste" },
      content: "Hallo.",
    });
    await repo.rebuild();
    const kinds = Object.fromEntries((await repo.listTexts()).map((t) => [t.id, t.sourceKind]));
    expect(kinds).toEqual({ t1: "ai", t2: "paste" });
  });
});
