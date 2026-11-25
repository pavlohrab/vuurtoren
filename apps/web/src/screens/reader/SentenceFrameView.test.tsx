import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnalyzedToken } from "@app/core";
import { describe, expect, it } from "vitest";
import { SentenceFrameView } from "./SentenceFrameView.js";

const TEXT = "Na een tijdje doet ze haar mond open.";
const ROWS: [string, string, string, number, string, number?][] = [
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
const TOKENS: AnalyzedToken[] = (() => {
  let from = 0;
  return ROWS.map(([text, pos, dep, head, form, prt], i) => {
    const start = TEXT.indexOf(text, from);
    from = start + text.length;
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
      particle_of: prt ?? null,
      zipf: 5,
    } as AnalyzedToken;
  });
})();

describe("SentenceFrameView", () => {
  it("shows the four parts; a part and a word explain themselves in one line", async () => {
    render(<SentenceFrameView tokens={TOKENS} sent={0} text={TEXT} />);
    for (const l of ["first", "verb", "middle", "verb end"])
      expect(screen.getByRole("button", { name: l })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "verb end" }));
    expect(screen.getByText(/doet … open is one verb/)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "ze" }));
    expect(screen.getByText("ze · pronoun · who does it")).toBeVisible();
  });

  it("Word types puts the kind under every word", async () => {
    render(<SentenceFrameView tokens={TOKENS} sent={0} text={TEXT} />);
    expect(screen.queryByText("noun")).toBeNull();
    await userEvent.click(screen.getByRole("checkbox", { name: "Word types" }));
    expect(screen.getAllByText("noun")).toHaveLength(2);
  });
});
