import type { AnalyzedToken } from "@app/core";
import { describe, expect, it } from "vitest";
import { contextGloss, withoutArticle } from "./contextGloss.js";

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
    expect(contextGloss(t, t[1]!)).toEqual({ fixed: "his", notTheCard: true });
    expect(contextGloss(t, t[4]!)).toEqual({ fixed: "our", notTheCard: true });
  });

  it("the verb 'zijn' and the pronoun 'ons' keep their cards", () => {
    const t = sentence([
      ["Wij", "wij", "PRON"],
      ["zijn", "zijn", "AUX"],
      ["thuis", "thuis", "ADV"],
      ["bij", "bij", "ADP"],
      ["ons", "ons", "PRON", "Case=Acc|Person=1|PronType=Prs"],
    ]);
    expect(contextGloss(t, t[1]!)).toEqual({ notTheCard: false });
    expect(contextGloss(t, t[4]!)).toEqual({ notTheCard: false });
  });

  it("'heel' before an adjective, an adverb or 'veel' is 'very'; 'het hele huis' is not", () => {
    const veel = sentence([
      ["heel", "heel", "ADJ"],
      ["veel", "veel", "DET"],
    ]);
    expect(contextGloss(veel, veel[0]!).fixed).toBe("very");
    const mooi = sentence([
      ["heel", "heel", "ADV"],
      ["mooi", "mooi", "ADJ"],
    ]);
    expect(contextGloss(mooi, mooi[0]!).fixed).toBe("very");
    const huis = sentence([
      ["het", "het", "DET"],
      ["hele", "heel", "ADJ"],
      ["huis", "huis", "NOUN"],
    ]);
    expect(contextGloss(huis, huis[1]!).fixed).toBeUndefined();
  });

  it("a name is looked up as written, not as a lemma's card ('Kampen' is not 'kamp')", () => {
    const t = sentence([
      ["Kampen", "kamp", "PROPN"],
      ["is", "zijn", "AUX"],
    ]);
    expect(contextGloss(t, t[0]!)).toEqual({ lemma: "Kampen", notTheCard: true });
  });

  it("a diminutive is its own word ('bankje', 'bankjes' are not 'bank')", () => {
    const t = sentence([
      ["bankje", "bank", "NOUN"],
      ["bankjes", "bank", "NOUN"],
      ["meisje", "meisje", "NOUN"],
    ]);
    expect(contextGloss(t, t[0]!)).toEqual({ lemma: "bankje", notTheCard: true });
    expect(contextGloss(t, t[1]!)).toEqual({ lemma: "bankje", notTheCard: true });
    // Already a word of its own in the dictionary: its card stays.
    expect(contextGloss(t, t[2]!)).toEqual({ notTheCard: false });
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
