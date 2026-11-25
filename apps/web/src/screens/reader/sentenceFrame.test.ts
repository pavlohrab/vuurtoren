import type { AnalyzedToken } from "@app/core";
import { describe, expect, it } from "vitest";
import { WORD_KIND, sentenceFrame, wordRole } from "./sentenceFrame.js";

type Row = [text: string, pos: string, dep: string, head: number, form: string, prtOf?: number];

/** Tokens as the language server gives them (the rows are real spaCy parses). */
function tokens(rows: Row[]): AnalyzedToken[] {
  let at = 0;
  return rows.map(([text, pos, dep, head, form, prtOf], i) => {
    const start = at;
    at += text.length + 1;
    return {
      i,
      text,
      lemma: text.toLowerCase(),
      alt_lemmas: [],
      pos,
      morph: form ? `VerbForm=${form}` : "",
      dep,
      head,
      sent: 0,
      start,
      end: start + text.length,
      is_word: pos !== "PUNCT",
      is_propn: false,
      is_num: false,
      particle_of: prtOf ?? null,
      zipf: 5,
    } as AnalyzedToken;
  });
}

const fields = (rows: Row[]) =>
  sentenceFrame(tokens(rows), 0)?.parts.map((p) => [p.field, p.tokens]) ?? null;

describe("sentenceFrame", () => {
  it("first place · verb · middle · verb end, with the split verb's particle at the end", () => {
    const rows: Row[] = [
      ["Na", "ADP", "case", 2, ""],
      ["een", "DET", "det", 2, ""],
      ["tijdje", "NOUN", "obl", 3, ""],
      ["doet", "VERB", "ROOT", 3, "Fin"],
      ["ze", "PRON", "nsubj", 3, ""],
      ["haar", "PRON", "nmod:poss", 6, ""],
      ["mond", "NOUN", "obj", 3, ""],
      ["open", "ADJ", "compound:prt", 3, "", 3],
      [".", "PUNCT", "punct", 3, ""],
    ];
    expect(fields(rows)).toEqual([
      ["first", [0, 1, 2]],
      ["verb", [3]],
      ["middle", [4, 5, 6]],
      ["end", [7]],
    ]);
    expect(sentenceFrame(tokens(rows), 0)?.particle).toBe(7);
  });

  it("a question has no first place", () => {
    expect(
      fields([
        ["Doe", "VERB", "ROOT", 0, "Fin"],
        ["je", "PRON", "nsubj", 0, ""],
        ["de", "DET", "det", 3, ""],
        ["deur", "NOUN", "obj", 0, ""],
        ["open", "ADJ", "compound:prt", 0, "", 0],
        ["?", "PUNCT", "punct", 0, ""],
      ]),
    ).toEqual([
      ["verb", [0]],
      ["middle", [1, 2, 3]],
      ["end", [4]],
    ]);
  });

  it("the helping verb is second, the participle at the end", () => {
    expect(
      fields([
        ["Hij", "PRON", "nsubj", 4, ""],
        ["heeft", "AUX", "aux", 4, "Fin"],
        ["het", "DET", "det", 3, ""],
        ["boek", "NOUN", "obj", 4, ""],
        ["gelezen", "VERB", "ROOT", 4, "Part"],
        [".", "PUNCT", "punct", 4, ""],
      ]),
    ).toEqual([
      ["first", [0]],
      ["verb", [1]],
      ["middle", [2, 3]],
      ["end", [4]],
    ]);
  });

  it("a clause of its own after the verb is one part", () => {
    expect(
      fields([
        ["Ik", "PRON", "nsubj", 1, ""],
        ["weet", "VERB", "ROOT", 1, "Fin"],
        ["dat", "SCONJ", "mark", 5, ""],
        ["hij", "PRON", "nsubj", 5, ""],
        ["morgen", "ADV", "advmod", 5, ""],
        ["komt", "VERB", "ccomp", 1, "Fin"],
        [".", "PUNCT", "punct", 1, ""],
      ]),
    ).toEqual([
      ["first", [0]],
      ["verb", [1]],
      ["rest", [2, 3, 4, 5]],
    ]);
  });

  it("no conjugated verb, no frame", () => {
    expect(
      fields([
        ["Nou", "ADV", "ROOT", 0, ""],
        ["ja", "INTJ", "fixed", 0, ""],
        [".", "PUNCT", "punct", 0, ""],
      ]),
    ).toBeNull();
  });

  it("names the kind and the role in plain words", () => {
    const [ze] = tokens([["ze", "PRON", "nsubj", 1, ""]]);
    expect(WORD_KIND[ze!.pos]).toBe("pronoun");
    expect(wordRole(ze!)).toBe("who does it");
  });
});
