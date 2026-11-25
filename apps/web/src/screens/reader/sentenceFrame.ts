/**
 * The Dutch sentence frame of a sentence (m5, WC4; notes/wc2-word-card.md §5): first place ·
 * the conjugated verb · the middle · the verb end, worked out on the device from what every
 * analysed token already has (part of speech, morphology, dependency label and head). No new
 * data, so it works for stories, synced texts and live analysis alike.
 *
 * v1 covers the main clause; a subordinate clause after the verb end is one part, "rest". A
 * sentence without a conjugated verb in its main clause (a fragment like "Nou ja,") has no
 * frame: the tab then shows only the kinds of words.
 */
import type { AnalyzedToken } from "@app/core";

export type Field = "first" | "verb" | "middle" | "end" | "rest";

export interface FramePart {
  field: Field;
  /** Token indices (into the text's tokens), in order. */
  tokens: number[];
}

export interface Frame {
  parts: FramePart[];
  /** The conjugated verb of the main clause. */
  verb: number;
  /** The particle of a split verb ("doet … open"), when there is one. */
  particle: number | null;
}

/** Dependency labels that start a clause of their own. */
const SUBCLAUSE = new Set(["advcl", "ccomp", "acl", "acl:relcl", "csubj", "xcomp", "parataxis"]);

const finite = (t: AnalyzedToken) =>
  (t.pos === "VERB" || t.pos === "AUX") && t.morph.includes("VerbForm=Fin");
const nonFinite = (t: AnalyzedToken) =>
  (t.pos === "VERB" || t.pos === "AUX") && /VerbForm=(Inf|Part)/.test(t.morph);

/** Is `t` inside a clause of its own (on its way up to the root it passes a clause label)? */
function inSubclause(tokens: readonly AnalyzedToken[], t: AnalyzedToken): boolean {
  let cur = t;
  for (let guard = 0; guard < 64; guard++) {
    if (SUBCLAUSE.has(cur.dep)) return true;
    const up = tokens[cur.head];
    if (!up || up.i === cur.i) return false;
    cur = up;
  }
  return false;
}

export function sentenceFrame(tokens: readonly AnalyzedToken[], sent: number): Frame | null {
  const words = tokens.filter((t) => t.sent === sent && t.pos !== "PUNCT" && t.pos !== "SPACE");
  const main = words.filter((t) => !inSubclause(tokens, t));
  const verb = main.find(finite);
  if (!verb) return null;
  const particle = main.find((t) => t.particle_of === verb.i)?.i ?? null;

  const before = main.filter((t) => t.i < verb.i);
  const after = words.filter((t) => t.i > verb.i);
  // The verb end: the particle and the other verbs of the main clause, at its end.
  const closes = (t: AnalyzedToken) =>
    !inSubclause(tokens, t) && (t.i === particle || nonFinite(t));
  const mainAfter = after.filter((t) => !inSubclause(tokens, t));
  let endStart = mainAfter.length;
  while (endStart > 0 && closes(mainAfter[endStart - 1]!)) endStart--;
  const end = mainAfter.slice(endStart);
  const endFrom = end[0]?.i ?? Infinity;
  const middle = after.filter((t) => t.i < endFrom && !inSubclause(tokens, t));
  const rest = after.filter((t) => inSubclause(tokens, t) && t.i > (end.at(-1)?.i ?? verb.i));
  // Words of a clause of their own inside the middle stay in the middle.
  const inside = after.filter((t) => inSubclause(tokens, t) && t.i < endFrom && !rest.includes(t));

  const parts: FramePart[] = [];
  const add = (field: Field, list: readonly AnalyzedToken[]) => {
    if (list.length) parts.push({ field, tokens: list.map((t) => t.i).sort((a, b) => a - b) });
  };
  add("first", before);
  add("verb", [verb]);
  add("middle", [...middle, ...inside]);
  add("end", end);
  add("rest", rest);
  return { parts, verb: verb.i, particle };
}

/** The kind of word, in plain English (from spaCy's part of speech). */
export const WORD_KIND: Record<string, string> = {
  NOUN: "noun",
  PROPN: "name",
  VERB: "verb",
  AUX: "verb",
  ADJ: "adjective",
  ADV: "adverb",
  PRON: "pronoun",
  DET: "article",
  ADP: "preposition",
  CCONJ: "conjunction",
  SCONJ: "conjunction",
  NUM: "number",
  PART: "particle",
  INTJ: "interjection",
};

/** What a word does in its sentence, in plain words, when the parse says it clearly. */
export function wordRole(t: AnalyzedToken): string | null {
  switch (t.dep) {
    case "nsubj":
    case "nsubj:pass":
      return "who does it";
    case "obj":
      return "what";
    case "iobj":
      return "to whom";
    case "obl":
      return "where, when or how";
    case "advmod":
      return "how, when or where";
    case "compound:prt":
      return "part of the verb";
    case "aux":
    case "aux:pass":
      return "helping verb";
    case "cop":
      return "links to what follows";
    case "amod":
      return "says more about a noun";
    default:
      return null;
  }
}
