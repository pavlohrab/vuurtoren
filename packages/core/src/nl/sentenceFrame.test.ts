import type { AnalyzedToken } from "../reading/types.js";
import { describe, expect, it } from "vitest";
import { WORD_KIND, wordRole } from "./sentenceFrame.js";

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

describe("words in the Sentence tab", () => {
  it("names the kind and the role in plain words", () => {
    const [ze] = tokens([["ze", "PRON", "nsubj", 1, ""]]);
    expect(WORD_KIND[ze!.pos]).toBe("pronoun");
    expect(wordRole(ze!)).toBe("who does it");
  });
});
