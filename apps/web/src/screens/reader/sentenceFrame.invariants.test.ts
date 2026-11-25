/**
 * Checks that hold for every sentence (F3): each word sits in exactly one clause, a […] points at
 * a clause that sits there, and each clause has its verb. Run on every sentence of the bundled
 * stories, so a word can't get lost again (it did: "meneer Haddad hartelijk").
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AnalyzedToken } from "@app/core";
import { sentenceClauses } from "./sentenceFrame.js";

interface StoryFile {
  stories: { slug: string; content: string; tokens: unknown[][] }[];
}

function storyTokens(s: StoryFile["stories"][number]): AnalyzedToken[] {
  return s.tokens.map((t, i) => ({
    i,
    text: s.content.slice(t[7] as number, t[8] as number),
    lemma: t[0] as string,
    alt_lemmas: t[1] as string[],
    pos: t[2] as string,
    morph: t[3] as string,
    dep: t[4] as string,
    head: t[5] as number,
    sent: t[6] as number,
    start: t[7] as number,
    end: t[8] as number,
    is_word: ((t[9] as number) & 1) !== 0,
    is_propn: ((t[9] as number) & 2) !== 0,
    is_num: ((t[9] as number) & 4) !== 0,
    particle_of: t[10] as number | null,
    zipf: t[11] as number,
  }));
}

/** What's wrong with one sentence's clauses, or [] when nothing is. */
export function clauseProblems(toks: readonly AnalyzedToken[], sent: number): string[] {
  const clauses = sentenceClauses(toks, sent);
  if (!clauses.length) return [];
  const words = toks.filter((t) => t.sent === sent && t.pos !== "PUNCT" && t.pos !== "SPACE");
  const seen = new Map<number, number>();
  const problems: string[] = [];
  clauses.forEach((c, k) => {
    let hasVerb = false;
    for (const p of c.parts)
      for (const x of p.items) {
        if (typeof x === "number") {
          seen.set(x, (seen.get(x) ?? 0) + 1);
          if (x === c.verb) hasVerb = true;
        } else if (clauses[x.clause]?.parent !== k)
          problems.push(`[…] in clause ${k} points elsewhere`);
      }
    if (!hasVerb && c.kind !== "phrase") problems.push(`clause ${k} has no verb`);
  });
  for (const w of words) {
    const n = seen.get(w.i) ?? 0;
    if (n !== 1) problems.push(`"${w.text}" in ${n} clauses`);
  }
  return problems;
}

describe("every story sentence", () => {
  it("has each word in exactly one clause, and each clause its verb", () => {
    const file = JSON.parse(
      readFileSync("../../content/stories/stories.json", "utf8"), // tests run in apps/web
    ) as StoryFile;
    const bad: string[] = [];
    for (const s of file.stories) {
      const toks = storyTokens(s);
      for (const sent of new Set(toks.map((t) => t.sent))) {
        const p = clauseProblems(toks, sent);
        if (p.length) {
          const text = toks
            .filter((t) => t.sent === sent)
            .map((t) => t.text)
            .join(" ");
          bad.push(`${s.slug}: ${text}\n    ${p.join("; ")}`);
        }
      }
    }
    expect(bad.length, bad.slice(0, 40).join("\n")).toBe(0);
  });
});
