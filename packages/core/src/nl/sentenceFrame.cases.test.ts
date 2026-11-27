/**
 * The sentence-structure test set (frames.cases.ts): every sentence's clauses, as text, against
 * the answers written by hand. The tokens come from the language server (frames.fixture.json).
 */
import { type Clause, frameTokens, sentenceClauses } from "./index.js";
import { describe, expect, it } from "vitest";
import type { AnalyzedToken } from "../reading/types.js";
import { FRAME_CASES } from "./frames.cases.js";
import fixture from "./frames.fixture.json";

/** "main: first|verb|middle|end|rest", words as text, […] for a clause inside. */
function clauseText(toks: readonly AnalyzedToken[], c: Clause): string {
  const text = (p: Clause["parts"][number]) =>
    p.items.map((x) => (typeof x === "number" ? toks[x]!.text : "[…]")).join(" ");
  // A joining word shows as "(Maar) " before the clause's first place.
  const link = c.parts.find((p) => p.field === "link");
  const rest = c.parts.filter((p) => p.field !== "link");
  return `${c.kind}: ${link ? `(${text(link)}) ` : ""}${rest.map(text).join("|")}`;
}

const tokensOf = (s: string) => frameTokens((fixture as Record<string, AnalyzedToken[]>)[s]!);

describe("sentence structure on the test set", () => {
  for (const c of FRAME_CASES) {
    // A case marked hard is skipped, with its reason in its name.
    const run = c.hard ? it.skip : it;
    run(`${c.about}: ${c.sentence}${c.hard ? ` (hard: ${c.hard})` : ""}`, () => {
      const toks = tokensOf(c.sentence);
      expect(sentenceClauses(toks, 0).map((x) => clauseText(toks, x))).toEqual(c.clauses);
    });
  }
});
