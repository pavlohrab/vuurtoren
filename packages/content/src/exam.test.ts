import { describe, expect, it } from "vitest";
import {
  A2_EXAM,
  EXAM_PARTS,
  ExamContentError,
  KNM_PER_THEME,
  countAnswerWords,
  examBank,
  examSets,
  groupQuestions,
  mcGroups,
  missedVocab,
  optionOrder,
  parseExamBank,
  passMark,
  scoreMc,
  scoreRubric,
} from "./index.js";

const bank = examBank();

describe("exam bank nl-a2", () => {
  it("has at least two mock exams per part", () => {
    for (const part of EXAM_PARTS) expect(examSets(part).length).toBeGreaterThanOrEqual(2);
  });

  it("has a full-size Lezen and Luisteren mock (about 25 questions each)", () => {
    for (const part of ["lezen", "luisteren"] as const) {
      for (const set of examSets(part)) {
        expect(groupQuestions(mcGroups(part, { set })).length).toBeGreaterThanOrEqual(24);
      }
    }
  });

  it("has at least 80 KNM questions over the eight official themes; a mock is 40", () => {
    expect(bank.knm.map((t) => t.id)).toHaveLength(8);
    expect(bank.knm.reduce((n, t) => n + t.questions.length, 0)).toBeGreaterThanOrEqual(80);
    const mock1 = groupQuestions(mcGroups("knm", { set: 1 }));
    const mock2 = groupQuestions(mcGroups("knm", { set: 2 }));
    expect(mock1).toHaveLength(8 * KNM_PER_THEME);
    expect(new Set([...mock1, ...mock2].map((q) => q.id)).size).toBe(80);
    expect(groupQuestions(mcGroups("knm", { theme: "wonen" })).length).toBeGreaterThanOrEqual(10);
  });

  it("has four writing tasks (one form) and speaking prompts per mock", () => {
    for (const set of examSets("schrijven")) {
      const tasks = bank.schrijven.tasks.filter((t) => t.set === set);
      expect(tasks).toHaveLength(4);
      expect(tasks.filter((t) => t.kind === "form")).toHaveLength(1);
    }
    for (const set of examSets("spreken")) {
      expect(bank.spreken.prompts.filter((p) => p.set === set).length).toBeGreaterThanOrEqual(8);
    }
  });

  it("knows the official parts and durations", () => {
    expect(A2_EXAM.parts.map((p) => [p.part, p.minutes])).toEqual([
      ["lezen", 65],
      ["luisteren", 45],
      ["schrijven", 40],
      ["spreken", 35],
      ["knm", 45],
    ]);
    expect(A2_EXAM.lastChecked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("parseExamBank", () => {
  const minimal = () => ({
    lezen: {
      texts: [
        {
          id: "t1",
          set: 1,
          kind: "sign",
          title: "Bord",
          text: "Open",
          vocab: { open: "open" },
          questions: [{ id: "q1", q: "?", options: ["a", "b"], answer: 1, explain: "x" }],
        },
      ],
    },
    luisteren: { fragments: [] },
    schrijven: { tasks: [], rubric: { form: ["x"], message: ["y"] } },
    spreken: { prompts: [], rubric: ["z"] },
    knm: { themes: [] },
  });

  it("accepts a minimal bank", () => {
    expect(parseExamBank("t", minimal()).lezen[0]!.questions[0]!.answer).toBe(1);
  });

  it("rejects an answer out of range, duplicate ids and unknown grammar topics", () => {
    const a = minimal();
    a.lezen.texts[0]!.questions[0]!.answer = 2;
    expect(() => parseExamBank("t", a)).toThrow(ExamContentError);
    const b = minimal();
    b.lezen.texts[0]!.questions[0]!.id = "t1";
    expect(() => parseExamBank("t", b)).toThrow(/duplicate id t1/);
    const c = minimal() as Record<string, unknown>;
    c["spreken"] = {
      rubric: ["z"],
      prompts: [
        {
          id: "p",
          set: 1,
          kind: "short",
          situation: "s",
          question: "q",
          seconds: 20,
          model: "m",
          points: ["p"],
          grammar: ["nope"],
        },
      ],
    };
    expect(() => parseExamBank("t", c as never, new Set(["inversion"]))).toThrow(
      /unknown grammar topic nope/,
    );
  });
});

describe("scoring", () => {
  it("computes the estimated pass mark", () => {
    expect(passMark(25, 0.72)).toBe(18);
    expect(passMark(40, 0.7)).toBe(28);
    expect(passMark(4, 0.65)).toBe(3);
  });

  it("scores multiple choice and lists wrong ids (unanswered counts as wrong)", () => {
    const qs = groupQuestions(mcGroups("lezen", { set: 1 }));
    const answers = Object.fromEntries(qs.map((q) => [q.id, q.answer]));
    expect(scoreMc("lezen", qs, answers)).toMatchObject({
      correct: 25,
      total: 25,
      passed: true,
      wrong: [],
    });
    delete answers[qs[0]!.id];
    answers[qs[1]!.id] = (qs[1]!.answer + 1) % qs[1]!.options.length;
    const s = scoreMc("lezen", qs, answers);
    expect(s).toMatchObject({ correct: 23, passMark: 18, passed: true });
    expect(s.wrong).toEqual([qs[0]!.id, qs[1]!.id]);
  });

  it("scores a rubric", () => {
    expect(scoreRubric("schrijven", 4, 6)).toMatchObject({ passMark: 4, passed: true });
    expect(scoreRubric("schrijven", 3, 6).passed).toBe(false);
  });

  it("collects the vocabulary of texts with wrong answers", () => {
    const groups = mcGroups("lezen", { set: 1 });
    const words = missedVocab(groups, ["lz-1-02-a"]);
    expect(words.map((w) => w.lemma)).toEqual(["volwassene", "douchen", "fles"]);
    expect(missedVocab(groups, [])).toEqual([]);
  });

  it("shuffles options stably", () => {
    const q = { id: "x", options: ["a", "b", "c"] };
    const o = optionOrder(q, "s1");
    expect([...o].sort()).toEqual([0, 1, 2]);
    expect(optionOrder(q, "s1")).toEqual(o);
    const firsts = new Set(Array.from({ length: 30 }, (_, i) => optionOrder(q, `s${i}`)[0]));
    expect(firsts.size).toBe(3);
  });

  it("counts words", () => {
    expect(countAnswerWords("Beste buren,\n\nZaterdag 12 oktober — feest!")).toBe(5);
  });
});
