import { describe, expect, it } from "vitest";
import { grammarTopic } from "@app/content";
import { type AnalyzedToken, type GrammarHit, WORD_NOTE_TOPICS } from "@app/core";
import { wordGrammarLines } from "./WordGrammar.js";

const tok = (
  i: number,
  text: string,
  lemma: string,
  pos: string,
  morph: string,
  dep: string,
  head: number,
): AnalyzedToken => ({
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
  particle_of: null,
  zipf: 5,
});

// "Ik zie hem." (captured from the NLP server) plus a detector hit on «hem».
const TOKENS = [
  tok(0, "Ik", "ik", "PRON", "Case=Nom|Person=1|PronType=Prs", "nsubj", 1),
  tok(1, "zie", "zien", "VERB", "Number=Sing|Tense=Pres|VerbForm=Fin", "ROOT", 1),
  tok(2, "hem", "hem", "PRON", "Case=Acc|Person=3|PronType=Prs", "obj", 1),
  tok(3, ".", ".", "PUNCT", "", "punct", 1),
];
const hit = (topic: string, tokens: number[]): GrammarHit => ({
  topic,
  tokens,
  sent: 0,
  start: 0,
  end: 10,
  note: `${topic} note`,
});

describe("wordGrammarLines", () => {
  it("links every explainer topic to an existing grammar page", () => {
    for (const id of WORD_NOTE_TOPICS) expect(grammarTopic(id), id).toBeDefined();
  });

  it("gives the explainer's notes with their topic pages and the clause order", () => {
    const { lines, order } = wordGrammarLines(TOKENS, 1, []);
    expect(lines.map((l) => [l.key, l.topic?.id])).toEqual([["verb.present.ik", "present-tense"]]);
    expect(order?.topic?.id).toBe("word-order-v2");
  });

  it("adds detector notes only for topics the explainer did not cover", () => {
    const hits = [hit("object-pronouns", [2]), hit("modal-particles", [2])];
    const { lines } = wordGrammarLines(TOKENS, 2, hits);
    expect(lines.map((l) => l.key)).toEqual(["pron.object", "hit.modal-particles"]);
  });

  it("drops the plain line when a detector knows more", () => {
    const t = [tok(0, "toch", "toch", "ADV", "", "advmod", 0)];
    expect(wordGrammarLines(t, 0, []).lines.map((l) => l.key)).toEqual(["plain"]);
    const { lines } = wordGrammarLines(t, 0, [hit("modal-particles", [0])]);
    expect(lines.map((l) => l.text)).toEqual(["modal-particles note"]);
  });
});
