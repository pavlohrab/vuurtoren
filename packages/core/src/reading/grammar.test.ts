import { describe, expect, it } from "vitest";
import { type GrammarHit, wordOrderNote } from "./grammar.js";
import { tokenize } from "./testutil.js";

const hit = (topic: string, tokens: number[], sent: number, note = topic): GrammarHit => ({
  topic,
  tokens,
  sent,
  start: 0,
  end: 0,
  note,
});

describe("wordOrderNote", () => {
  it("prefers a verb at the end over verb second", () => {
    const hits = [hit("inversion", [7, 8], 0, "inv"), hit("subordinate-clauses", [0, 5], 0, "sub")];
    expect(wordOrderNote(hits, 0, [])).toMatchObject({ label: "Verb at the end", note: "sub" });
  });

  it("words a perfect tense by where the participle goes", () => {
    const tokens = tokenize("Ik heb een boek gelezen.");
    const note = wordOrderNote([hit("perfect-tense", [1, 4], 0)], 0, tokens);
    expect(note?.note).toBe("«heb» comes early and the participle «gelezen» goes to the end.");
  });

  it("is null without a word-order hit in the sentence", () => {
    expect(wordOrderNote([hit("plural-nouns", [1], 0), hit("inversion", [1, 2], 1)], 0, [])).toBe(
      null,
    );
  });
});
