import type { AnalyzedToken, SegmentPlan, TokenLabel } from "@app/core";

/**
 * Build tokens + one segment plan from a text. Words are \p{L}+ runs; `labels` maps a
 * word index (among words only) to its label (default "known"). `particles` maps the word
 * index of a detached particle to the word index of its verb.
 */
export function fixture(
  text: string,
  labels: Record<number, TokenLabel> = {},
  particles: Record<number, number> = {},
): { text: string; tokens: AnalyzedToken[]; plans: SegmentPlan[] } {
  const tokens: AnalyzedToken[] = [];
  const re = /\p{L}+|[^\p{L}\s]/gu;
  const wordIdx: number[] = [];
  for (const m of text.matchAll(re)) {
    const i = tokens.length;
    const isWord = /\p{L}/u.test(m[0]);
    if (isWord) wordIdx.push(i);
    tokens.push({
      i,
      text: m[0],
      lemma: m[0].toLowerCase(),
      alt_lemmas: [],
      pos: isWord ? "NOUN" : "PUNCT",
      morph: "",
      dep: "",
      head: i,
      sent: 0,
      start: m.index,
      end: m.index + m[0].length,
      is_word: isWord,
      is_propn: false,
      is_num: false,
      particle_of: null,
      zipf: 4,
    });
  }
  for (const [p, v] of Object.entries(particles)) {
    const t = tokens[wordIdx[Number(p)] as number];
    if (t) t.particle_of = wordIdx[v] as number;
  }
  const plan: SegmentPlan = {
    segment: {
      index: 0,
      tokenStart: 0,
      tokenEnd: tokens.length,
      charStart: 0,
      charEnd: text.length,
    },
    tokens: tokens.map((t) => {
      const wi = wordIdx.indexOf(t.i);
      const label: TokenLabel = wi < 0 ? "nonword" : (labels[wi] ?? "known");
      return {
        i: t.i,
        label,
        key: wi < 0 ? null : t.lemma,
        pKnown: label === "learning" ? 0.6 : 0.9,
      };
    }),
    coverage: 0.96,
    newTypes: [],
    introduce: [],
    gloss: [],
    clozes: [],
  };
  return { text, tokens, plans: [plan] };
}
