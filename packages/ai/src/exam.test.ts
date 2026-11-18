import { describe, expect, it } from "vitest";
import { buildExamItemPrompt, examFeedback, generateExamItem, parseExamItem } from "./exam.js";
import { fakeAnalyze, fakeProvider, modelOf } from "./test-util.js";

const item = (text: string) =>
  JSON.stringify({
    title: "Brief",
    text,
    questions: [{ q: "Wat?", options: ["a", "b", "c"], answer: 2, explain: "c" }],
    vocab: { brief: "letter" },
  });

describe("exam items", () => {
  it("prompt carries the format, level and vocabulary", () => {
    const p = buildExamItemPrompt({ part: "luisteren", vocabEstimate: 800, knownLemmas: ["bus"] });
    expect(p).toContain("A2");
    expect(p).toContain("800");
    expect(p).toContain("bus");
    expect(p).toContain('"lines"');
    expect(p).toContain("Never copy official exam items");
  });

  it("parses and validates items", () => {
    expect(parseExamItem(item("De bus komt."), "lezen")).toMatchObject({
      title: "Brief",
      questions: [{ answer: 2 }],
      vocab: { brief: "letter" },
    });
    expect(parseExamItem("not json", "lezen")).toBeNull();
    // A listening item needs lines; a bad answer index drops the question.
    expect(parseExamItem(item("Situatie."), "luisteren")).toBeNull();
    const bad = JSON.stringify({
      text: "x",
      questions: [{ q: "?", options: ["a", "b"], answer: 5 }],
    });
    expect(parseExamItem(bad, "lezen")).toBeNull();
  });

  it("rewrites once when coverage is low and keeps the better version", async () => {
    const provider = fakeProvider([item("De bus komt morgen laat."), item("De bus komt.")]);
    const r = await generateExamItem(
      { provider, analyze: fakeAnalyze, model: modelOf(["de", "bus", "komt"]) },
      { part: "lezen", vocabEstimate: 500, knownLemmas: ["bus"] },
    );
    expect(r.rewritten).toBe(true);
    expect(r.item?.text).toBe("De bus komt.");
    expect(r.coverage).toBe(1);
    expect(provider.calls[1]!.messages.at(-1)!.content).toContain("morgen");
  });

  it("keeps the item when the language server is down", async () => {
    const provider = fakeProvider([item("De bus komt.")]);
    const r = await generateExamItem(
      { provider, analyze: () => Promise.reject(new Error("down")), model: modelOf([]) },
      { part: "lezen", vocabEstimate: 500, knownLemmas: [] },
    );
    expect(r).toMatchObject({ coverage: null, rewritten: false });
    expect(r.item).not.toBeNull();
  });
});

describe("exam feedback", () => {
  it("maps verdicts to the checklist and parses corrections", async () => {
    const provider = fakeProvider([
      JSON.stringify({
        summary: "Clear.",
        points: [
          { ok: true, note: "yes" },
          { ok: false, note: "missing" },
        ],
        corrections: [
          { wrong: "ik komen", right: "ik kom", why: "verb form" },
          { wrong: "", right: "x" },
        ],
        improved: "Ik kom niet.",
      }),
    ]);
    const f = await examFeedback(provider, {
      part: "schrijven",
      task: "Schrijf een briefje.",
      points: ["Wanneer", "Waarom"],
      answer: "Ik komen niet.",
    });
    expect(f.points).toEqual([
      { point: "Wanneer", ok: true, note: "yes" },
      { point: "Waarom", ok: false, note: "missing" },
    ]);
    expect(f.corrections).toEqual([{ wrong: "ik komen", right: "ik kom", why: "verb form" }]);
    expect(f.parseFailed).toBe(false);
  });

  it("falls back to the raw text", async () => {
    const f = await examFeedback(fakeProvider(["Looks fine."]), {
      part: "spreken",
      task: "t",
      points: ["p"],
      answer: "a",
    });
    expect(f).toMatchObject({ parseFailed: true, summary: "Looks fine." });
  });
});
