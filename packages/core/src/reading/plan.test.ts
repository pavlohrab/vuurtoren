import { describe, expect, it } from "vitest";
import type { WordKnowledge } from "../memory.js";
import { planSegment, planText, relabelKey, zipfFloor } from "./plan.js";
import { segmentTokens } from "./segment.js";
import { filler, known, learning, model, tokenize, type Overrides } from "./testutil.js";
import { DEFAULT_PLANNER, type AnalyzedToken, type PlannerOptions } from "./types.js";

const noClozes: PlannerOptions = { ...DEFAULT_PLANNER, clozes: false };

/** Model marking every word of `toks` known, except those in `except` (and given overrides). */
function knownExcept(
  toks: AnalyzedToken[],
  except: string[] = [],
  extra: Record<string, WordKnowledge> = {},
) {
  const entries: Record<string, WordKnowledge> = {};
  for (const t of toks) if (t.is_word && !except.includes(t.lemma)) entries[t.lemma] = known(0.99);
  return model({ ...entries, ...extra });
}

function plan(text: string, except: string[], over: Overrides, opts: PlannerOptions) {
  const toks = tokenize(text, over);
  const seg = segmentTokens(toks, 100_000)[0]!; // whole text as one segment
  return { toks, plan: planSegment(toks, seg, knownExcept(toks, except), opts) };
}

describe("zipfFloor", () => {
  it.each([
    [300, 4.43],
    [1000, 4.36],
    [8000, 3.96],
  ])("vocab %i -> %f", (v, f) => expect(zipfFloor(v)).toBeCloseTo(f, 2));
  it("is monotonically non-increasing and clamped", () => {
    expect(zipfFloor(1)).toBeLessThanOrEqual(5);
    expect(zipfFloor(1e12)).toBe(2.5);
    expect(zipfFloor(2000)).toBeLessThan(zipfFloor(1000));
    expect(zipfFloor(4000)).toBeGreaterThan(zipfFloor(8000));
  });
});

describe("planSegment: unknown words", () => {
  const text = `${filler(1, 6)} Alpha beta alpha ${filler(1, 4)}`;

  it("introduces frequent unknown words and glosses rare ones", () => {
    const { plan: p } = plan(
      text,
      ["alpha", "beta"],
      { alpha: { zipf: 5 }, beta: { zipf: 2.8 } },
      noClozes,
    );
    expect(p.introduce).toEqual(["alpha"]);
    expect(p.gloss).toEqual(["beta"]);
    expect(p.newTypes).toEqual(["alpha", "beta"]); // sorted by usefulness (2x5 vs 1x2.8)
    expect(p.tokens.filter((t) => t.label === "introduce")).toHaveLength(2); // ALL occurrences
    expect(p.tokens.filter((t) => t.label === "gloss")).toHaveLength(1);
  });

  it("the zipf floor (from vocabEstimate) decides which words come first", () => {
    // beta: once, zipf 4.1; gamma: twice, zipf 3.2 (higher repeats x zipf score)
    const t = `${filler(1, 6)} Beta gamma gamma ${filler(1, 4)}`;
    const over = { beta: { zipf: 4.1 }, gamma: { zipf: 3.2 } };
    const opts = { ...noClozes, newWordBudget: 1 };
    // vocab 8000 -> floor 3.96: beta is "worth learning now", preferred over gamma
    expect(
      plan(t, ["beta", "gamma"], over, { ...opts, vocabEstimate: 8000 }).plan.introduce,
    ).toEqual(["beta"]);
    // vocab 1000 -> floor 4.36: neither passes; the budget is filled by score -> gamma
    expect(
      plan(t, ["beta", "gamma"], over, { ...opts, vocabEstimate: 1000 }).plan.introduce,
    ).toEqual(["gamma"]);
  });

  it("ranks by repeats x zipf", () => {
    const t = "rare rare rare freq " + filler(1, 6);
    const { plan: p } = plan(
      t,
      ["rare", "freq"],
      { rare: { zipf: 4.6 }, freq: { zipf: 6 } },
      {
        ...noClozes,
        newWordBudget: 1,
      },
    );
    // budget: round(1 * 10 / 300) = 0 -> at least 1
    expect(p.introduce).toEqual(["rare"]);
    expect(p.gloss).toEqual(["freq"]);
  });

  it("budget is B per page of 150 words (exactly B on short pages, scaled on long ones)", () => {
    const unknownWords = Array.from({ length: 12 }, (_, i) => `u${"abcdefghijkl"[i]}`);
    const over: Overrides = Object.fromEntries(unknownWords.map((w) => [w, { zipf: 5 }]));
    const build = (fillerSentences: number) =>
      plan(`${unknownWords.join(" ")}. ${filler(fillerSentences, 10)}`, unknownWords, over, {
        ...noClozes,
        newWordBudget: 3,
      }).plan;
    const long = build(29); // 12 + 290 = 302 words -> 3 x 302/150 = 6
    expect(long.introduce).toHaveLength(6);
    expect(long.gloss).toHaveLength(6);
    expect(build(13).introduce).toHaveLength(3); // 152 words -> 3
    expect(build(0).introduce).toHaveLength(3); // 12 words (short page) -> still 3
    const none = plan(`${unknownWords.join(" ")}.`, unknownWords, over, {
      ...noClozes,
      newWordBudget: 0,
    }).plan;
    expect(none.introduce).toEqual([]);
    expect(none.gloss).toHaveLength(12);
  });

  it("introduces nothing when no unknown is above the floor, and never when none exist", () => {
    const { plan: p } = plan(
      text,
      ["alpha", "beta"],
      { alpha: { zipf: 2 }, beta: { zipf: 1 } },
      noClozes,
    );
    expect(p.introduce).toEqual([]);
    expect(p.gloss).toHaveLength(2);
    const none = plan(filler(2, 7), [], {}, noClozes).plan;
    expect(none).toMatchObject({
      newTypes: [],
      introduce: [],
      gloss: [],
      coverage: expect.any(Number),
    });
  });

  it("does not plan proper nouns or numbers", () => {
    const t = `Anna 42 ${filler(1, 6)}`;
    const { plan: p } = plan(t, ["anna", "42"], { anna: { is_propn: true } }, noClozes);
    expect(p.newTypes).toEqual([]);
    expect(p.tokens.filter((x) => x.label === "ignored")).toHaveLength(2);
    expect(p.coverage).toBeCloseTo(0.99, 10);
  });

  it("does not count a detached particle separately and mirrors its verb", () => {
    const t = "Ik bel je op. " + filler(1, 6);
    const { toks, plan: p } = plan(
      t,
      ["bel", "op"],
      { op: { particle_of: 1 }, bel: { zipf: 5 } },
      noClozes,
    );
    const op = toks.findIndex((x) => x.text === "op");
    expect(p.newTypes).toEqual(["bel"]);
    expect(p.tokens[op]!.label).toBe("introduce");
    expect(p.tokens[op]!.key).toBe("bel");
    // counted: ik, bel, je + 6 fillers = 9 (op excluded)
    expect(p.countedWords).toBe(9);
    expect(p.coverage).toBeCloseTo((8 * 0.99) / 9, 10);
  });

  it("reports coverage of the base model, independent of labels", () => {
    const { plan: p } = plan(text, ["alpha"], { alpha: { zipf: 5 } }, noClozes);
    // 13 counted words, 2 unknown
    expect(p.coverage).toBeCloseTo((11 * 0.99) / 13, 10);
  });
});

describe("planSegment: clozes", () => {
  /** Six 8-word sentences; every word learning at 0.8 unless overridden. */
  const sentences = Array.from({ length: 6 }, (_, s) =>
    Array.from({ length: 8 }, (_, w) => `s${"abcdef"[s]}w${"abcdefgh"[w]}`).join(" "),
  );
  const text = sentences.map((s) => s + ".").join(" ");
  const allLearning = (toks: AnalyzedToken[], p = 0.8) =>
    model(Object.fromEntries(toks.filter((t) => t.is_word).map((t) => [t.lemma, learning(p)])));
  const run = (toks: AnalyzedToken[], m = allLearning(toks), opts = DEFAULT_PLANNER) =>
    planSegment(toks, segmentTokens(toks)[0]!, m, opts);

  it("places at most one per sentence, floor(n/2) per segment, none in sentence 0", () => {
    const toks = tokenize(text);
    const p = run(toks);
    expect(p.clozes).toHaveLength(3);
    expect([...p.clozes]).toEqual([...p.clozes].sort((a, b) => a - b));
    const sentIdx = p.clozes.map((i) => toks[i]!.sent);
    expect(new Set(sentIdx).size).toBe(3);
    expect(sentIdx.every((s) => s > 0)).toBe(true);
    expect(p.clozes.every((i) => p.tokens[i]!.label === "cloze")).toBe(true);
    expect(p.tokens.filter((t) => t.label === "cloze")).toHaveLength(3);
  });

  it("is off when opts.clozes is false", () => {
    expect(run(tokenize(text), undefined, noClozes).clozes).toEqual([]);
  });

  it("needs at least 2 sentences", () => {
    const toks = tokenize(sentences[0]! + ".");
    expect(run(toks).clozes).toEqual([]);
  });

  it("skips sentences shorter than 6 words", () => {
    const short = tokenize("aa bb cc dd ee. ff gg hh ii jj. kk ll mm nn oo.");
    expect(run(short).clozes).toEqual([]);
    const ok = tokenize("aa bb cc dd ee. ff gg hh ii jj kk. ll mm nn oo pp.");
    expect(run(ok).clozes).toHaveLength(1); // floor(3/2) = 1; only sentence 1 is long enough
    expect(ok[run(ok).clozes[0]!]!.sent).toBe(1);
  });

  it.each([
    ["too certain", 0.995],
    ["too uncertain", 0.5],
    ["just below range", 0.59],
    ["just above range", 1],
  ])("excludes words with pKnown out of [0.6, 0.99]: %s", (_n, p) => {
    const toks = tokenize(text);
    expect(run(toks, allLearning(toks, p)).clozes).toEqual([]);
  });

  it.each([0.6, 0.99])("includes pKnown at the boundary %f", (p) => {
    const toks = tokenize(text);
    expect(run(toks, allLearning(toks, p)).clozes).toHaveLength(3);
  });

  it("prefers learning words, then lower pKnown", () => {
    const toks = tokenize("aa bb cc dd ee ff gg. hh ii jj kk ll mm nn. oo pp qq rr ss tt uu.");
    const m = model({
      ...Object.fromEntries(toks.filter((t) => t.is_word).map((t) => [t.lemma, known(0.99)])),
      jj: known(0.72), // known but lower p
      kk: learning(0.9), // learning wins over known
      ll: learning(0.8), // lowest p among learning
    });
    const p = run(toks, m);
    expect(p.clozes).toHaveLength(1); // floor(3/2)
    expect(toks[p.clozes[0]!]!.text).toBe("ll");
  });

  it("never clozes particles, proper nouns, numbers or 1-char tokens", () => {
    const toks = tokenize("aa bb cc dd ee ff. Anna 42 x op bel gg hh. ii jj kk ll mm nn.", {
      anna: { is_propn: true },
      op: { particle_of: 24 },
    });
    // find verb index for "op" -> bel
    const bel = toks.findIndex((t) => t.text === "bel");
    toks.find((t) => t.text === "op")!.particle_of = bel;
    const m = model({
      ...Object.fromEntries(toks.filter((t) => t.is_word).map((t) => [t.lemma, learning(0.8)])),
      anna: learning(0.8),
    });
    const p = run(toks, m);
    const chosen = p.clozes.map((i) => toks[i]!.text);
    // sentence 1 has the excluded words plus bel/gg/hh; only those are valid there
    for (const bad of ["Anna", "42", "x", "op"]) expect(chosen).not.toContain(bad);
    expect(p.tokens[toks.findIndex((t) => t.text === "op")]!.label).not.toBe("cloze");
  });

  it("does not cloze unknown words", () => {
    const toks = tokenize(text);
    const p = run(toks, new Map());
    expect(p.clozes).toEqual([]);
  });

  describe("assumed-familiar words", () => {
    // Every word known beyond the cloze range except "sbwc" (sentence 1), which has no evidence.
    const setup = (extra: Record<string, WordKnowledge> = {}) => {
      const toks = tokenize(text);
      const m = model({
        ...Object.fromEntries(toks.filter((t) => t.is_word).map((t) => [t.lemma, known(0.995)])),
        ...extra,
      });
      if (!extra["sbwc"]) m.delete("sbwc");
      return { toks, m };
    };
    const glossOnly = { ...DEFAULT_PLANNER, newWordBudget: 0 };
    const assumed = new Set(["sbwc"]);

    it("become clozes without evidence", () => {
      const { toks, m } = setup();
      expect(run(toks, m, glossOnly).clozes).toEqual([]);
      const p = run(toks, m, { ...glossOnly, assumedFamiliar: assumed });
      expect(p.clozes.map((i) => toks[i]!.text)).toEqual(["sbwc"]);
    });

    it("change nothing else: glosses and coverage stay as without them", () => {
      const { toks, m } = setup();
      const without = run(toks, m, glossOnly);
      const withA = run(toks, m, { ...glossOnly, assumedFamiliar: assumed });
      expect(withA.gloss).toEqual(without.gloss);
      expect(withA.introduce).toEqual(without.introduce);
      expect(withA.newTypes).toEqual(without.newTypes);
      expect(withA.coverage).toBe(without.coverage);
      // an assumed word is never glossed because of the assumption
      const known99 = setup({ sbwc: known(0.995) });
      const p = run(known99.toks, known99.m, { ...glossOnly, assumedFamiliar: assumed });
      expect(p.gloss).toEqual([]);
    });

    it("are not blanked while introduced, nor when ignored", () => {
      const { toks, m } = setup();
      const intro = run(toks, m, {
        ...DEFAULT_PLANNER,
        newWordBudget: 3,
        assumedFamiliar: assumed,
      });
      expect(intro.introduce).toEqual(["sbwc"]);
      expect(intro.clozes).toEqual([]);
      const ignored = setup({ sbwc: { state: "ignored", pKnown: 1 } });
      expect(
        run(ignored.toks, ignored.m, { ...glossOnly, assumedFamiliar: assumed }).clozes,
      ).toEqual([]);
    });
  });

  it("keeps a particle visible when its verb becomes a cloze", () => {
    const toks = tokenize("aa bb cc dd ee ff. gg hh ii jj bel op. kk ll mm nn oo pp.", {
      op: { particle_of: 11 },
    });
    expect(toks[11]!.text).toBe("bel");
    // only "bel" is a valid cloze candidate in sentence 1
    const m = model({
      ...Object.fromEntries(toks.filter((t) => t.is_word).map((t) => [t.lemma, known(0.99)])),
      bel: learning(0.8),
    });
    const p = run(toks, m);
    expect(p.clozes).toEqual([11]);
    expect(p.tokens[12]!.label).toBe("learning");
  });
});

describe("planText", () => {
  it("plans every segment, deterministically", () => {
    const text = filler(40, 12);
    const toks = tokenize(text);
    const m = knownExcept(toks, [toks[3]!.lemma, toks[200]!.lemma]);
    const a = planText(toks, m, DEFAULT_PLANNER, text);
    const b = planText(toks, m, DEFAULT_PLANNER, text);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(2);
    expect(a.flatMap((p) => p.tokens)).toHaveLength(toks.length);
    expect(a[0]!.newTypes).toEqual([toks[3]!.lemma]);
  });

  it("returns [] for empty input", () => {
    expect(planText([], new Map(), DEFAULT_PLANNER)).toEqual([]);
  });
});

describe("planSegment: words already in Anki", () => {
  it("never introduces or glosses an overdue learning word", () => {
    const toks = tokenize("Ik zie de fiets bij het huis.");
    const m = knownExcept(toks, ["fiets"], { fiets: learning(0.2) });
    const p = planSegment(toks, segmentTokens(toks, 100_000)[0]!, m, noClozes);
    const fiets = p.tokens.find((t) => toks[t.i]!.text === "fiets")!;
    expect(fiets.label).toBe("learning");
    expect(p.introduce).not.toContain("fiets");
    expect(p.gloss).not.toContain("fiets");
  });
});

describe("planSegment: budget fill", () => {
  it("fills the budget below the zipf floor, but never with rare words", () => {
    const text = "Ik zie aa bb cc dd ee vandaag.";
    const over = {
      aa: { zipf: 5.0 }, // above floor
      bb: { zipf: 4.0 }, // below floor (vocab 300 -> 4.43), fill
      cc: { zipf: 3.5 }, // fill
      dd: { zipf: 2.5 }, // rare: never introduced
      ee: { zipf: 3.1 }, // fill
    };
    const unknown = ["aa", "bb", "cc", "dd", "ee"];
    const at = (B: number) =>
      plan(text, unknown, over, { ...noClozes, vocabEstimate: 300, newWordBudget: B }).plan;
    expect(at(1).introduce).toEqual(["aa"]);
    expect(at(3).introduce).toEqual(["aa", "bb", "cc"]);
    expect(at(8).introduce).toEqual(["aa", "bb", "cc", "ee"]);
    expect(at(8).gloss).toEqual(["dd"]);
  });
});

describe("clozes skip function words", () => {
  it("never blanks prepositions, articles, pronouns or auxiliaries", () => {
    const text = "Ik zie de man. Wij lopen met de hond naar het park vandaag.";
    const fn = {
      met: { pos: "ADP" },
      de: { pos: "DET" },
      het: { pos: "DET" },
      wij: { pos: "PRON" },
      naar: { pos: "ADP" },
    };
    const toks = tokenize(text, fn);
    const learningAll: Record<string, ReturnType<typeof learning>> = {};
    for (const t of toks) if (t.is_word) learningAll[t.lemma] = learning(0.8);
    const p = planSegment(
      toks,
      segmentTokens(toks, 100_000)[0]!,
      model(learningAll),
      DEFAULT_PLANNER,
    );
    for (const i of p.clozes) expect(["ADP", "DET", "PRON"]).not.toContain(toks[i]!.pos);
    expect(p.clozes.length).toBeGreaterThan(0);
  });
});

describe("relabelKey", () => {
  const plan = {
    segment: { index: 0, tokenStart: 0, tokenEnd: 4, charStart: 0, charEnd: 20 },
    tokens: [
      { i: 0, label: "introduce" as const, key: "toren", pKnown: 0 },
      { i: 1, label: "known" as const, key: "de", pKnown: 1 },
      { i: 2, label: "introduce" as const, key: "toren", pKnown: 0 },
      { i: 3, label: "cloze" as const, key: "toren", pKnown: 0.6 },
    ],
    coverage: 0.5,
    newTypes: ["toren"],
    introduce: ["toren"],
    gloss: [],
    clozes: [3],
  };

  it("marks every token of the word known at once, and leaves clozes where they are", () => {
    const next = relabelKey(plan, "toren", "known");
    expect(next.tokens.map((t) => t.label)).toEqual(["known", "known", "known", "cloze"]);
    expect(next.introduce).toEqual([]);
    expect(next.newTypes).toEqual([]);
    expect(next.clozes).toEqual([3]);
  });

  it("returns the same plan when the word is not on the page", () => {
    expect(relabelKey(plan, "koe", "known")).toBe(plan);
  });
});
