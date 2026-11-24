import type { AnalyzedToken } from "@app/core";
import { describe, expect, it } from "vitest";
import { contextGloss, meaningInSentence, withoutArticle } from "./contextGloss.js";

/** Tokens of one sentence: [text, lemma, pos, morph?]. */
function sentence(words: [string, string, string, string?][]): AnalyzedToken[] {
  return words.map(
    ([text, lemma, pos, morph = ""], i) =>
      ({
        i,
        text,
        lemma,
        alt_lemmas: [],
        pos,
        morph,
        dep: "",
        head: i,
        sent: 0,
        start: 0,
        end: 0,
        is_word: true,
        is_propn: pos === "PROPN",
        is_num: false,
        particle_of: null,
        zipf: 5,
      }) as unknown as AnalyzedToken,
  );
}

describe("contextGloss", () => {
  it("a possessive means my/his/our, not its card's verb or pronoun ('zijn hond', 'onze straat')", () => {
    const t = sentence([
      ["met", "met", "ADP"],
      ["zijn", "zijn", "PRON", "Person=3|Poss=Yes|PronType=Prs"],
      ["hond", "hond", "NOUN"],
      ["in", "in", "ADP"],
      ["onze", "ons", "PRON", "Person=1|Poss=Yes|PronType=Prs"],
      ["straat", "straat", "NOUN"],
    ]);
    expect(contextGloss(t[1]!)).toEqual({ fixed: "his", notTheCard: true });
    expect(contextGloss(t[4]!)).toEqual({ fixed: "our", notTheCard: true });
  });

  it("the verb 'zijn' and the pronoun 'ons' keep their cards", () => {
    const t = sentence([
      ["Wij", "wij", "PRON"],
      ["zijn", "zijn", "AUX"],
      ["thuis", "thuis", "ADV"],
      ["bij", "bij", "ADP"],
      ["ons", "ons", "PRON", "Case=Acc|Person=1|PronType=Prs"],
    ]);
    expect(contextGloss(t[1]!)).toEqual({ notTheCard: false });
    expect(contextGloss(t[4]!)).toEqual({ notTheCard: false });
  });

  it("a name is looked up as written, not as a lemma's card ('Kampen' is not 'kamp')", () => {
    const t = sentence([
      ["Kampen", "kamp", "PROPN"],
      ["is", "zijn", "AUX"],
    ]);
    expect(contextGloss(t[0]!)).toEqual({ lemma: "Kampen", notTheCard: true });
  });

  it("a diminutive is its own word ('bankje', 'bankjes' are not 'bank')", () => {
    const t = sentence([
      ["bankje", "bank", "NOUN"],
      ["bankjes", "bank", "NOUN"],
      ["meisje", "meisje", "NOUN"],
    ]);
    expect(contextGloss(t[0]!)).toEqual({ lemma: "bankje", notTheCard: true });
    expect(contextGloss(t[1]!)).toEqual({ lemma: "bankje", notTheCard: true });
    // Already a word of its own in the dictionary: its card stays.
    expect(contextGloss(t[2]!)).toEqual({ notTheCard: false });
  });
});

describe("withoutArticle", () => {
  it("drops a leading a/an/the, keeps the rest", () => {
    expect(withoutArticle("a garden, yard")).toBe("garden, yard");
    expect(withoutArticle("an apple")).toBe("apple");
    expect(withoutArticle("the")).toBe("the");
    expect(withoutArticle("garden")).toBe("garden");
  });
});

/** Real alignments from the language server (nl→en, 24 Nov 2026). */
describe("meaningInSentence", () => {
  const pick = (
    pos: string,
    usual: string | undefined,
    meanings: string[],
    text: string,
    confidence: number,
    translation: string,
  ) => meaningInSentence({ pos, usual, meanings, aligned: { text, confidence }, translation });

  it("keeps the usual meaning when the sentence says it (walks → to walk, kids → child, kid)", () => {
    expect(
      pick("VERB", "to walk", ["to walk"], "walks", 0.24, "Every morning he walks his dog."),
    ).toBeNull();
    expect(
      pick("NOUN", "child, kid", ["child, kid"], "kids", 0.36, "The kids come by a lot."),
    ).toBeNull();
  });

  it("picks the meaning the sentence uses among the word's own ('bank': couch, not bank)", () => {
    expect(
      pick("NOUN", "bank", ["bank", "sofa, couch", "bench"], "couch", 0.26, "That's a good couch."),
    ).toEqual({ text: "couch", inSentence: false });
  });

  it("shows the sentence's English when the usual meaning is not in it ('vroeger': old days)", () => {
    expect(
      pick("ADV", "early", ["early", "earlier"], "old days", 0.24, "a story about the old days."),
    ).toEqual({ text: "old days", inSentence: true });
    expect(
      pick("ADJ", "whole", ["whole", "complete, full"], "lots", 0.31, "He's got lots of flowers."),
    ).toEqual({ text: "lots", inSentence: true });
  });

  it("a weak alignment does not replace a meaning the sentence agrees with", () => {
    // "woont" was aligned to "She" (0.18), but "living" is in the translation.
    expect(
      pick("VERB", "to live", ["to live"], "She", 0.18, "She's been living on our street."),
    ).toBeNull();
  });

  it("a sure alignment wins ('bankje' without a dictionary meaning of its own: bench)", () => {
    expect(
      pick("NOUN", "sofa", ["sofa"], "bench", 0.98, "he sits on a bench outside his house"),
    ).toEqual({ text: "bench", inSentence: true });
  });

  it("leaves grammar words to the grammar ('zijn' as a verb is not decided here)", () => {
    expect(pick("AUX", "to be", ["to be"], "is", 0.9, "That is good.")).toBeNull();
    expect(pick("PRON", "us", ["us"], "our", 0.9, "our street")).toBeNull();
  });

  it("a separable verb keeps its meaning; the sentence's English loses a capital", () => {
    expect(
      meaningInSentence({
        pos: "VERB",
        usual: "to pass by",
        meanings: ["to pass by"],
        aligned: { text: "often come", confidence: 0.57 },
        translation: "The kids often come by.",
        separable: true,
      }),
    ).toBeNull();
    expect(pick("NOUN", "kid", ["kid"], "Children", 0.9, "Children play.")).toEqual({
      text: "children",
      inSentence: true,
    });
  });
});
