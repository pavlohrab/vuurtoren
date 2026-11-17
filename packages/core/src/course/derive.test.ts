import { describe, expect, it } from "vitest";
import {
  type ParseToken,
  deriveGapAnswer,
  detectTense,
  placeholderSentence,
  subjectByRules,
  subjectFromParse,
} from "./derive.js";
import type { WordForms } from "../practice/types.js";

const wonen: WordForms = {
  participle: "gewoond",
  aux: "hebben",
  past: ["woonde", "woonden"],
  present: { ik: "woon", jij: "woont", hij: "woont", wij: "wonen", jullie: "wonen", zij: "wonen" },
};
const heten: WordForms = {
  participle: "geheten",
  past: ["heette", "heetten"],
  present: { ik: "heet", jij: "heet", hij: "heet", wij: "heten", jullie: "heten", zij: "heten" },
};
const opbellen: WordForms = {
  participle: "opgebeld",
  past: ["belde op", "belden op"],
  present: {
    ik: "bel op",
    jij: "belt op",
    hij: "belt op",
    wij: "bellen op",
    jullie: "bellen op",
    zij: "bellen op",
  },
  separable: { particle: "op", stem: "bellen" },
};

/** Run rule-based derivation on a prompt like "Anne ____ (wonen) in Nijmegen." */
function derive(
  prompt: string,
  forms: WordForms,
  instruction = "Vul de goede vorm van het verbum in.",
) {
  const m = /^(.*?)_{2,}\s*\(([^)]+)\)(.*)$/.exec(prompt)!;
  const before = m[1]!;
  const after = m[3]!;
  return deriveGapAnswer({
    instruction,
    before,
    after,
    hint: m[2]!,
    forms,
    subject: subjectByRules(before, after),
  });
}

describe("subject detection by rules", () => {
  it("handles pronouns, names and coordinated subjects", () => {
    expect(subjectByRules("Ik ", " in Utrecht.")?.person).toBe("ik");
    expect(subjectByRules("Anne ", " in Nijmegen.")).toMatchObject({
      person: "hij",
      confidence: 0.7,
    });
    expect(subjectByRules("Willem en Mila ", " samen.")?.person).toBe("zij");
    expect(subjectByRules("Jij en ik ", " samen.")?.person).toBe("wij");
  });

  it("finds the subject after the verb in questions", () => {
    const g = subjectByRules("Hoe ", " jij?");
    expect(g).toMatchObject({ person: "jij", inverted: true });
    expect(subjectByRules("Waar ", " Mila en Willem?")?.person).toBe("zij");
  });

  it("marks ambiguous zij/ze with an alternative and lowers confidence", () => {
    const g = subjectByRules("Zij ", " in een winkel.");
    expect(g).toMatchObject({ person: "hij", alt: "zij", confidence: 0.6 });
  });
});

describe("subject detection from a parse", () => {
  const tok = (i: number, text: string, over: Partial<ParseToken>): ParseToken => ({
    i,
    text,
    lemma: text.toLowerCase(),
    pos: "NOUN",
    morph: "",
    dep: "dep",
    head: 0,
    start: 0,
    is_word: true,
    ...over,
  });
  it("uses nsubj + conjuncts for plural", () => {
    const text = "Willem en Mila wonen in Utrecht.";
    const toks = [
      tok(0, "Willem", { pos: "PROPN", dep: "nsubj", head: 3, start: 0 }),
      tok(1, "en", { pos: "CCONJ", dep: "cc", head: 2, start: 7 }),
      tok(2, "Mila", { pos: "PROPN", dep: "conj", head: 0, start: 10 }),
      tok(3, "wonen", { pos: "VERB", dep: "ROOT", head: 3, start: text.indexOf("wonen") }),
    ];
    expect(subjectFromParse(toks, text.indexOf("wonen"))).toMatchObject({
      person: "zij",
      inverted: false,
    });
  });
  it("detects inversion and plural nouns", () => {
    const toks = [
      tok(0, "Hoe", { pos: "ADV", head: 1, start: 0 }),
      tok(1, "heten", { pos: "VERB", dep: "ROOT", head: 1, start: 4 }),
      tok(2, "jij", { pos: "PRON", dep: "nsubj", head: 1, start: 10 }),
    ];
    expect(subjectFromParse(toks, 4)).toMatchObject({ person: "jij", inverted: true });
    const kids = [
      tok(0, "kinderen", { dep: "nsubj", head: 1, start: 3, morph: "Number=Plur" }),
      tok(1, "spelen", { pos: "VERB", dep: "ROOT", head: 1, start: 12 }),
    ];
    expect(subjectFromParse(kids, 12)?.person).toBe("zij");
  });
  it("returns null without a matching token", () => {
    expect(subjectFromParse([], 3)).toBeNull();
  });
});

describe("placeholder sentence", () => {
  it("fills the first blank with the lemma and drops the hint", () => {
    expect(placeholderSentence("Anne ____ (wonen) in Nijmegen.", "wonen")).toEqual({
      text: "Anne wonen in Nijmegen.",
      offset: 5,
    });
    expect(placeholderSentence("Geen gat hier.", "x")).toBeNull();
  });
});

describe("tense", () => {
  it("reads the instruction and cue words", () => {
    expect(detectTense("Vul het imperfectum in.", "Ik ", "").tense).toBe("past");
    expect(detectTense("Vul in.", "Gisteren ", " ik thuis.").tense).toBe("past");
    expect(detectTense("Vul in.", "Ik heb gisteren ", ".").tense).toBe("perfect");
    expect(detectTense("Vul in.", "Ik wil graag ", ".").tense).toBe("infinitive");
    expect(detectTense("Vul in.", "Ik probeer te ", ".").tense).toBe("infinitive");
    expect(detectTense("Vul in.", "Ik ", " hier.").tense).toBe("present");
  });
});

describe("derived answers", () => {
  it("conjugates the present", () => {
    expect(derive("Ik ____ (wonen) in Utrecht.", wonen)).toMatchObject({
      answer: "woon",
      confidence: 0.95,
    });
    expect(derive("Wij ____ (wonen) hier.", wonen).answer).toBe("wonen");
  });
  it("handles coordinated subjects", () => {
    expect(derive("Willem en Mila ____ (wonen) in Delft.", wonen).answer).toBe("wonen");
  });
  it("drops the -t after inverted jij", () => {
    expect(derive("Waar ____ (wonen) jij?", wonen).answer).toBe("woon");
    expect(derive("Hoe ____ (heten) jij?", heten).answer).toBe("heet");
    expect(derive("Jij ____ (wonen) in Delft.", wonen).answer).toBe("woont");
  });
  it("derives past and perfect from cues", () => {
    expect(derive("Gisteren ____ (wonen) wij nog in Delft.", wonen).answer).toBe("woonden");
    expect(derive("Ik heb vroeger in Delft ____ (wonen).", wonen).answer).toBe("gewoond");
    expect(derive("Anne ____ (wonen) vroeger in Delft.", wonen)).toMatchObject({
      answer: "woonde",
      tense: "past",
    });
  });
  it("accepts both readings of ambiguous zij and flags low confidence", () => {
    const r = derive("Zij ____ (wonen) in Delft.", wonen);
    expect(r.answer).toBe("woont");
    expect(r.accept).toEqual(["wonen"]);
    expect(r.confidence).toBeLessThan(0.7);
  });
  it("removes the particle when it stands later in the sentence", () => {
    expect(derive("Anne ____ (opbellen) haar zus op.", opbellen).answer).toBe("belt");
    expect(derive("Anne ____ (opbellen).", opbellen).answer).toBe("belt op");
  });
  it("gives no answer without forms", () => {
    expect(derive("Anne ____ (xyz) hier.", {})).toEqual({ confidence: 0 });
  });
});
