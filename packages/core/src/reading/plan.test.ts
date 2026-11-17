import { describe, expect, it } from "vitest";
import type { WordKnowledge } from "../memory.js";
import { planSegment, planText, zipfFloor } from "./plan.js";
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
    [1000, 4.5],
    [8000, 3.3],
  ])("vocab %i -> %f", (v, f) => expect(zipfFloor(v)).toBeCloseTo(f, 10));
  it("is monotonically non-increasing and clamped", () => {
    expect(zipfFloor(1)).toBe(5);
    expect(zipfFloor(100_000_000)).toBe(2.5);
    expect(zipfFloor(2000)).toBeLessThan(zipfFloor(1000));
    expect(zipfFloor(4000)).toBeGreaterThan(zipfFloor(8000));
  });
});

describe("planSegment: unknown words", () => {
  const text = `${filler(1, 6)} Alpha beta alpha ${filler(1, 4)}`;

  it("introduces frequent unknown words and glosses ones below the zipf floor", () => {
    const { plan: p } = plan(
      text,
      ["alpha", "beta"],
      { alpha: { zipf: 5 }, beta: { zipf: 3 } },
      noClozes,
    );
    expect(p.introduce).toEqual(["alpha"]);
    expect(p.gloss).toEqual(["beta"]);
    expect(p.newTypes).toEqual(["alpha", "beta"]); // sorted by usefulness (2x5 vs 1x3)
    expect(p.tokens.filter((t) => t.label === "introduce")).toHaveLength(2); // ALL occurrences
    expect(p.tokens.filter((t) => t.label === "gloss")).toHaveLength(1);
  });

  it("the zipf floor depends on vocabEstimate", () => {
    const over = { beta: { zipf: 3.5 } };
    const low = plan(text, ["beta"], over, { ...noClozes, vocabEstimate: 1000 }).plan;
    const high = plan(text, ["beta"], over, { ...noClozes, vocabEstimate: 8000 }).plan;
    expect(low.introduce).toEqual([]);
    expect(low.gloss).toEqual(["beta"]);
    expect(high.introduce).toEqual(["beta"]);
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

  it("scales the budget with segment length (B x words / 300, min 1)", () => {
    const unknownWords = Array.from({ length: 12 }, (_, i) => `u${"abcdefghijkl"[i]}`);
    const over: Overrides = Object.fromEntries(unknownWords.map((w) => [w, { zipf: 5 }]));
    const build = (fillerSentences: number) =>
      plan(`${unknownWords.join(" ")}. ${filler(fillerSentences, 10)}`, unknownWords, over, {
        ...noClozes,
        newWordBudget: 6,
      }).plan;
    const full = build(29); // 12 + 290 = 302 words -> 6
    expect(full.introduce).toHaveLength(6);
    expect(full.gloss).toHaveLength(6);
    expect(build(13).introduce).toHaveLength(3); // 152 words -> 3
    expect(build(0).introduce).toHaveLength(1); // 12 words -> round(0.24)=0 -> min 1
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
    ["too certain", 0.99],
    ["too uncertain", 0.6],
    ["just below range", 0.69],
    ["just above range", 0.96],
  ])("excludes words with pKnown out of [0.7, 0.95]: %s", (_n, p) => {
    const toks = tokenize(text);
    expect(run(toks, allLearning(toks, p)).clozes).toEqual([]);
  });

  it.each([0.7, 0.95])("includes pKnown at the boundary %f", (p) => {
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
