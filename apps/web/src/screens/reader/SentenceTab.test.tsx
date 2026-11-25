import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnalyzedToken, SentencePairs } from "@app/core";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { SentenceTab } from "./SentenceTab.js";

// The panel's AI chat needs services; here only the linked sentence and parts matter.
vi.mock("../ReaderAI.js", () => ({
  SentencePanel: ({ text, frame }: { text: ReactNode; frame: ReactNode }) => (
    <>
      {text}
      {frame}
    </>
  ),
}));

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

const PAIRS: SentencePairs = {
  sent: 0,
  english: "After a while she opens her mouth.",
  englishTokens: [
    { start: 0, end: 5, text: "After" },
    { start: 6, end: 7, text: "a" },
    { start: 8, end: 13, text: "while" },
    { start: 14, end: 17, text: "she" },
    { start: 18, end: 23, text: "opens" },
    { start: 24, end: 27, text: "her" },
    { start: 28, end: 33, text: "mouth" },
    { start: 33, end: 34, text: "." },
  ],
  pairs: [
    { nl: [3, 7], en: [4], confidence: 0.9 },
    { nl: [4], en: [3], confidence: 0.9 },
    { nl: [6], en: [6], confidence: 0.9 },
  ],
  source: "story",
};

const colours = (name: string) =>
  screen.getAllByRole("button", { name }).map((b) => b.getAttribute("data-pc"));

describe("SentenceTab", () => {
  it("a tap lights a word and its partners; Ctrl-click adds the next colour", async () => {
    const user = userEvent.setup();
    render(
      <SentenceTab
        tokens={TOKENS}
        sent={0}
        text={TEXT}
        sentence={TEXT}
        pairs={PAIRS}
        grammar={[]}
      />,
    );
    // in the parts: "doet" lights up with "open" and the English "opens"
    await user.click(screen.getAllByRole("button", { name: "doet" }).at(-1)!);
    expect(colours("doet")).toEqual(["1", "1"]);
    expect(colours("open")).toEqual(["1", "1"]);
    expect(colours("opens")).toEqual(["1"]);
    await user.keyboard("{Control>}");
    await user.click(screen.getByRole("button", { name: "mouth" }));
    await user.keyboard("{/Control}");
    expect(colours("mond")).toEqual(["2", "2"]);
    expect(colours("doet")).toEqual(["1", "1"]);
    // a plain tap starts over
    await user.click(screen.getAllByRole("button", { name: "ze" })[0]!);
    expect(colours("ze")).toEqual(["1", "1"]);
    expect(colours("she")).toEqual(["1"]);
    expect(colours("mond")).toEqual([null, null]);
  });
});
