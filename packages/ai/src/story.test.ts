import { describe, expect, it } from "vitest";
import { buildStoryPrompt, estimateStoryTokens, generateStory, parseStory } from "./story.js";
import { fakeAnalyze, fakeProvider, modelOf } from "./test-util.js";

const model = modelOf(["ik", "ga", "naar", "de", "markt", "en", "koop", "brood", "een", "bij"]);
const setup = {
  topic: "de markt",
  length: "short" as const,
  vocabEstimate: 900,
  knownLemmas: ["ik", "ga", "markt"],
  targetWords: ["kraam"],
};
const story = (text: string, title = "Op de markt") =>
  JSON.stringify({ title, text, used_targets: ["kraam"] });

describe("story prompt and parsing", () => {
  it("carries level, vocabulary, targets, grammar, style and the JSON contract", () => {
    const p = buildStoryPrompt({
      ...setup,
      style: "dialogue",
      grammar: { title: "Inversion", summary: "verb second" },
    });
    expect(p.cached).toContain("900");
    expect(p.cached).toContain("markt");
    expect(p.cached).toContain("Target words: kraam");
    expect(p.cached).toContain("Inversion");
    expect(p.cached).toContain("dialogue");
    expect(p.cached).toContain('"used_targets"');
  });
  it("falls back to the raw text and the topic as title on invalid JSON", () => {
    expect(parseStory("Ik ga naar de markt.", "markt")).toEqual({
      ok: false,
      title: "markt",
      text: "Ik ga naar de markt.",
      usedTargets: [],
    });
  });
  it("estimates more tokens for longer stories", () => {
    const s = estimateStoryTokens({ length: "short", knownLemmas: setup.knownLemmas });
    const l = estimateStoryTokens({ length: "long", knownLemmas: setup.knownLemmas });
    expect(l.output).toBeGreaterThan(s.output);
  });
});

describe("generateStory", () => {
  it("accepts a covered story in one call and confirms the target word in the text", async () => {
    const p = fakeProvider([story("Ik ga naar de markt en koop brood bij een kraam")]);
    const steps: string[] = [];
    const r = await generateStory(
      { provider: p, analyze: fakeAnalyze, model, onProgress: (s) => steps.push(s) },
      setup,
    );
    expect(p.calls).toHaveLength(1);
    expect(p.calls[0]!.json).toBe(true);
    expect(r).toMatchObject({
      title: "Op de markt",
      coverage: 1,
      rewritten: false,
      foundTargets: ["kraam"],
      missingTargets: [],
      parseFailed: false,
    });
    expect(steps).toEqual(["writing", "checking"]);
  });

  it("rewrites ONCE naming the offending words and keeps a better rewrite", async () => {
    const p = fakeProvider([
      story("Ik flaneer naar de markt en aanschaf brood bij een kraam"),
      story("Ik ga naar de markt en koop brood bij een kraam"),
    ]);
    const r = await generateStory(
      { provider: p, analyze: fakeAnalyze, model, threshold: 0.95 },
      setup,
    );
    expect(p.calls).toHaveLength(2);
    const ask = p.calls[1]!.messages.at(-1)!.content;
    expect(ask).toContain("flaneer");
    expect(ask).toContain("aanschaf");
    expect(ask).not.toContain("kraam,");
    expect(r.rewritten).toBe(true);
    expect(r.coverage).toBe(1);
    expect(r.text).toContain("koop");
  });

  it("keeps the first text when the rewrite is worse, and never asks a third time", async () => {
    const p = fakeProvider([
      story("Ik flaneer naar de markt en koop brood"),
      story("Wij flaneren vandaag langzaam richting marktplein"),
    ]);
    const r = await generateStory({ provider: p, analyze: fakeAnalyze, model }, setup);
    expect(p.calls).toHaveLength(2);
    expect(r.rewritten).toBe(true);
    expect(r.text).toContain("Ik flaneer");
    expect(r.unknown).toEqual(["flaneer"]);
  });

  it("reports target words that the model claims but did not use", async () => {
    const p = fakeProvider([story("Ik ga naar de markt en koop brood")]);
    const r = await generateStory({ provider: p, analyze: fakeAnalyze, model }, setup);
    expect(r.claimedTargets).toEqual(["kraam"]);
    expect(r.foundTargets).toEqual([]);
    expect(r.missingTargets).toEqual(["kraam"]);
  });

  it("keeps the raw answer without a rewrite when the JSON is invalid", async () => {
    const p = fakeProvider(["Ik flaneer naar de markt."]);
    const r = await generateStory({ provider: p, analyze: fakeAnalyze, model }, setup);
    expect(p.calls).toHaveLength(1);
    expect(r).toMatchObject({ parseFailed: true, title: "de markt", rewritten: false });
    expect(r.text).toBe("Ik flaneer naar de markt.");
  });

  it("skips the checks when the language server is down", async () => {
    const p = fakeProvider([story("Ik flaneer naar de markt")]);
    const r = await generateStory(
      { provider: p, analyze: () => Promise.reject(new Error("503")), model },
      setup,
    );
    expect(p.calls).toHaveLength(1);
    expect(r.coverage).toBeNull();
    expect(r.foundTargets).toBeNull();
    expect(r.missingTargets).toEqual([]);
  });
});
