import { describe, expect, it } from "vitest";
import { classifyTokens, coverageOf } from "./classify.js";
import { known, learning, model, tokenize } from "./testutil.js";

describe("classifyTokens", () => {
  it("labels nonwords, ignored, known, learning and new", () => {
    const toks = tokenize("Anna zag 3 huizen, boom.", {
      anna: { is_propn: true },
      huizen: { lemma: "huis" },
    });
    const m = model({ zag: known(0.9), huis: learning(0.6) });
    const p = classifyTokens(toks, m);
    const byText = Object.fromEntries(toks.map((t, k) => [t.text, p[k]!]));
    expect(byText["Anna"]).toMatchObject({ label: "ignored", pKnown: 1 });
    expect(byText["zag"]).toMatchObject({ label: "known", key: "zag", pKnown: 0.9 });
    expect(byText["3"]).toMatchObject({ label: "ignored" });
    expect(byText["huizen"]).toMatchObject({ label: "learning", key: "huis", pKnown: 0.6 });
    expect(byText[","]).toMatchObject({ label: "nonword", key: null });
    expect(byText["boom"]).toMatchObject({ label: "new", key: "boom", pKnown: 0 });
  });

  it("matches via alt lemma or surface form and reports the matched key", () => {
    const toks = tokenize("kinderen", { kinderen: { lemma: "kind", alt_lemmas: ["kinder"] } });
    const p = classifyTokens(toks, model({ kinderen: known() }));
    expect(p[0]).toMatchObject({ label: "known", key: "kinderen" });
  });

  it("treats seen/unknown states as new but keeps their pKnown", () => {
    const toks = tokenize("a b");
    const p = classifyTokens(toks, model({ a: { state: "seen", pKnown: 0.2 } }));
    expect(p[0]).toMatchObject({ label: "new", pKnown: 0.2 });
  });

  it("honours user-ignored words from the model", () => {
    const toks = tokenize("ding");
    expect(classifyTokens(toks, model({ ding: { state: "ignored", pKnown: 0 } }))[0]).toMatchObject(
      { label: "ignored", pKnown: 1 },
    );
  });

  it("copies the verb's label to a detached particle", () => {
    const toks = tokenize("Ik bel je morgen op.", { op: { particle_of: 1 } });
    const p = classifyTokens(toks, model({ bel: learning(0.7) }));
    const op = p[toks.findIndex((t) => t.text === "op")]!;
    expect(op).toMatchObject({ label: "learning", key: "bel", pKnown: 0.7 });
    expect(op.i).toBe(toks.findIndex((t) => t.text === "op"));
  });
});

describe("coverageOf", () => {
  it("averages pKnown over counted words only", () => {
    const toks = tokenize("Anna zag een boom.", { anna: { is_propn: true } });
    const p = classifyTokens(toks, model({ zag: known(1), een: known(0.8) }));
    // counted: zag(1), een(0.8), boom(0) -> 1.8/3
    expect(coverageOf(p, toks)).toBeCloseTo(0.6, 10);
  });

  it("does not count detached particles", () => {
    const toks = tokenize("bel op", { op: { particle_of: 0 } });
    const p = classifyTokens(toks, model({ bel: known(1) }));
    expect(coverageOf(p, toks)).toBe(1); // only "bel" counts, p=1
    const toks2 = tokenize("bel op boom", { op: { particle_of: 0 } });
    const p2 = classifyTokens(toks2, model({ bel: known(1) }));
    expect(coverageOf(p2, toks2)).toBeCloseTo(0.5, 10);
  });

  it("is 1 when nothing is counted", () => {
    expect(coverageOf([], [])).toBe(1);
    const toks = tokenize("12 , 34");
    expect(coverageOf(classifyTokens(toks, model({})), toks)).toBe(1);
  });
});
