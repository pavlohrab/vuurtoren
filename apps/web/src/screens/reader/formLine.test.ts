import type { AnalyzedToken } from "@app/core";
import { describe, expect, it } from "vitest";
import { formLine } from "./formLine.js";

type T = [
  text: string,
  lemma: string,
  pos: string,
  morph: string,
  dep: string,
  head: number,
  prt?: number,
];

function toks(rows: T[]): AnalyzedToken[] {
  return rows.map(([text, lemma, pos, morph, dep, head, prt], i) => ({
    i,
    text,
    lemma,
    alt_lemmas: [],
    pos,
    morph,
    dep,
    head,
    sent: 0,
    start: 0,
    end: 0,
    is_word: pos !== "PUNCT",
    is_propn: false,
    is_num: false,
    particle_of: prt ?? null,
    zipf: 5,
  }));
}

describe("formLine", () => {
  it("a verb: the page's form, the tense and who", () => {
    const t = toks([
      ["Dat", "dat", "PRON", "", "nsubj", 1],
      ["moet", "moeten", "VERB", "Number=Sing|Tense=Pres|VerbForm=Fin", "ROOT", 1],
      ["weg", "weg", "ADV", "", "advmod", 1],
    ]);
    expect(formLine(t, 1)).toEqual({ said: "moet", what: "present, hij/zij/het" });
  });

  it("a subject pronoun names who; past tense", () => {
    const t = toks([
      ["Ik", "ik", "PRON", "", "nsubj", 1],
      ["liep", "lopen", "VERB", "Number=Sing|Tense=Past|VerbForm=Fin", "ROOT", 1],
    ]);
    expect(formLine(t, 1)).toEqual({ said: "liep", what: "past, ik" });
  });

  it("a command: first word, no subject, the bare stem", () => {
    const kijk = toks([
      ['"', '"', "PUNCT", "", "punct", 1],
      ["Kijk", "kijken", "VERB", "Number=Sing|Tense=Pres|VerbForm=Fin", "nsubj", 4],
      ["!", "!", "PUNCT", "", "punct", 1],
      ['"', '"', "PUNCT", "", "punct", 1],
      ["roept", "roepen", "VERB", "Number=Sing|Tense=Pres|VerbForm=Fin", "ROOT", 4],
    ]);
    expect(formLine(kijk, 1)).toEqual({ said: "Kijk", what: "command" });
    // A question with its subject is not a command; nor a form with -t.
    const woon = toks([
      ["Woon", "wonen", "VERB", "Number=Sing|Tense=Pres|VerbForm=Fin", "ROOT", 0],
      ["je", "je", "PRON", "", "nsubj", 0],
    ]);
    expect(formLine(woon, 0)?.what).toBe("present, je");
    const kijkt = toks([
      ["Kijkt", "kijken", "VERB", "Number=Sing|Tense=Pres|VerbForm=Fin", "ROOT", 0],
    ]);
    expect(formLine(kijkt, 0)?.what).toBe("present, hij/zij/het");
  });

  it("a split verb shows both parts, also when the particle is tapped", () => {
    const t = toks([
      ["ze", "ze", "PRON", "", "nsubj", 1],
      ["doet", "opendoen", "VERB", "Number=Sing|Tense=Pres|VerbForm=Fin", "ROOT", 1],
      ["open", "open", "ADP", "", "compound:prt", 1, 1],
    ]);
    const line = { said: "doet … open", what: "present, ze" };
    expect(formLine(t, 1)).toEqual(line);
    expect(formLine(t, 2)).toEqual(line);
  });

  it("nouns: plural and small; nothing when the page has the dictionary word", () => {
    const t = toks([
      ["huizen", "huis", "NOUN", "Number=Plur", "obj", 0],
      ["huisje", "huis", "NOUN", "Number=Sing", "obj", 0],
      ["huis", "huis", "NOUN", "Number=Sing", "obj", 0],
      ["Huis", "huis", "NOUN", "Number=Sing", "obj", 0],
    ]);
    expect(formLine(t, 0)).toEqual({ said: "huizen", what: "plural" });
    expect(formLine(t, 1)).toEqual({ said: "huisje", what: "small" });
    expect(formLine(t, 2)).toBeNull();
    expect(formLine(t, 3)).toBeNull();
  });

  it("an adjective's degree; a plain inflection says only the form", () => {
    const t = toks([
      ["groter", "groot", "ADJ", "Degree=Cmp", "amod", 0],
      ["grote", "groot", "ADJ", "Degree=Pos", "amod", 0],
    ]);
    expect(formLine(t, 0)).toEqual({ said: "groter", what: "comparative" });
    expect(formLine(t, 1)).toEqual({ said: "grote" });
  });
});
