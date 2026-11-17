import type { LearnerModel, WordState } from "@app/core";
import { createRepository } from "@app/db";
import { createNodeDriver } from "@app/db/node";
import { describe, expect, it, vi } from "vitest";
import type { AISentenceReport } from "./aiTypes.js";
import type { SentenceFill, SentenceNeed } from "./liveAI.js";
import { AI_WORDS_PER_SESSION, createLivePractice } from "./livePractice.js";
import type { PracticeData } from "@app/nlp-client";

const data: PracticeData = {
  forms: async () => ({}),
  sentences: async () => ({}),
  similar: async () => ({}),
  degraded: () => false,
};

async function setup(keys: [string, WordState][]) {
  const repo = await createRepository(await createNodeDriver(":memory:"));
  await repo.append({
    type: "AnkiSnapshotImported",
    lang: "nl",
    sources: ["Deck"],
    entries: keys.map(([key, state]) => ({
      key,
      state,
      pKnown: state === "known" ? 0.95 : 0.4,
      noteIds: [1],
      decks: ["Deck"],
      gloss: `${key} (en)`,
    })),
  });
  const fill = vi.fn<
    (lang: string, needs: SentenceNeed[], avoid: string[]) => Promise<SentenceFill>
  >(async (lang, needs) => {
    const sentences = needs.map((n) => [
      {
        text: `Ik zie de ${n.lemma} hier vandaag.`,
        target: [10, 10 + n.lemma!.length] as [number, number],
        translation: "I see it.",
      },
    ]);
    // Like liveAI: persist what was accepted.
    for (const [k, n] of needs.entries()) {
      await repo.append({
        type: "SentencesGenerated",
        lang,
        key: n.key,
        sentences: sentences[k]!,
        rejected: 1,
        provider: "custom",
        model: "fake",
      });
    }
    return { sentences, accepted: needs.length, rejected: needs.length, requested: needs.length };
  });
  const practice = createLivePractice({
    repo,
    lang: async () => "nl",
    model: async () => (await repo.learnerModel("nl")) as LearnerModel,
    dictionary: async () => ({}),
    composeGlosses: (info) => ({ glosses: info?.gloss ? [info.gloss] : [], article: undefined }),
    data,
    aiSentences: { ready: () => true, fill },
  });
  return { repo, practice, fill };
}

describe("practice with AI sentences", () => {
  it("fills words without sentences (capped), uses them in exercises and reuses them next time", async () => {
    const words: [string, WordState][] = Array.from({ length: 12 }, (_, i) => [
      `woord${String.fromCharCode(97 + i)}`,
      "learning",
    ]);
    const { practice, fill } = await setup(words);
    let report: AISentenceReport | null = null;
    const ex = await practice.startPractice({
      size: 20,
      aiSentences: true,
      onAISentences: (r) => (report = r),
    });
    expect(fill).toHaveBeenCalledTimes(1);
    const needs = fill.mock.calls[0]![1];
    expect(needs).toHaveLength(AI_WORDS_PER_SESSION);
    // the session's other targets are passed as words to avoid
    expect(fill.mock.calls[0]![2]).toEqual(needs.map((n) => n.key));
    expect(report).toEqual({ requested: 8, accepted: 8, rejected: 8, reused: 0 });
    expect(
      ex.some(
        (e) => e.prompt.sentence?.startsWith("Ik zie de") || e.prompt.text.includes("Ik zie de"),
      ),
    ).toBe(true);

    // Second session: stored sentences are reused, the filled words are not asked again.
    fill.mockClear();
    let second: AISentenceReport | null = null;
    await practice.startPractice({
      size: 20,
      aiSentences: true,
      onAISentences: (r) => (second = r),
    });
    const asked = fill.mock.calls.flatMap((c) => c[1].map((n) => n.key));
    expect(asked.filter((k) => needs.some((n) => n.key === k))).toEqual([]);
    expect(second!.reused).toBeGreaterThan(0);
  });

  it("does nothing without the option and leaves the session unchanged", async () => {
    const { practice, fill } = await setup([["fiets", "learning"]]);
    await practice.startPractice({ size: 5 });
    expect(fill).not.toHaveBeenCalled();
  });

  it("asks for grammar-topic sentences when the topic has few hits, and stores them for reuse", async () => {
    const { repo } = await setup([["fiets", "learning"]]);
    const fill = vi.fn(async (lang: string, needs: SentenceNeed[]): Promise<SentenceFill> => {
      const s = [
        {
          text: "Morgen ga ik naar school.",
          marks: [
            [0, 6],
            [7, 9],
          ] as [number, number][],
          note: "verb second",
        },
      ];
      await repo.append({
        type: "SentencesGenerated",
        lang,
        key: "",
        topic: needs[0]!.topicId!,
        sentences: s,
        provider: "custom",
        model: "fake",
      });
      return { sentences: [s], accepted: 1, rejected: 0, requested: 1 };
    });
    const practice = createLivePractice({
      repo,
      lang: async () => "nl",
      model: async () => repo.learnerModel("nl"),
      dictionary: async () => ({}),
      composeGlosses: () => ({ glosses: [], article: undefined }),
      data,
      topicMaterial: async () => ({ sentences: [], words: [] }),
      aiSentences: { ready: () => true, fill },
    });
    const opts = {
      detects: ["inversion"],
      kinds: ["scramble" as const],
      topicId: "inversion",
      aiSentences: true,
    };
    const ex = await practice.startTopicPractice(opts);
    expect(fill).toHaveBeenCalledTimes(1);
    expect(fill.mock.calls[0]![1]).toEqual([{ key: "", topicId: "inversion", existing: [] }]);
    expect(ex).toHaveLength(1);
    expect(ex[0]!.kind).toBe("scramble");
    await practice.startTopicPractice(opts);
    expect(fill).toHaveBeenCalledTimes(1);
  });
});
