/**
 * A word's meaning in its sentence, where the card or the lemma would give the wrong one.
 *
 * A card has one meaning, and the reader matches a word to its card by lemma: so "zijn" in
 * "zijn hond" got the verb card's "to be", "onze" got "us" (lemma "ons"), "heel" in "heel veel"
 * got "whole", "bankje" got "sofa" (lemma "bank") and the town "Kampen" got "camp" (lemma
 * "kamp"). The analysis says enough to do better: possessives carry `Poss=Yes`, names are
 * PROPN, a diminutive keeps its ending in the surface form, and "heel" before an adjective,
 * an adverb or "veel" means "very" (the tagger often calls it an adjective there).
 */
import type { AnalyzedToken } from "@app/core";

/** Possessive determiners, by their form: the meaning is fixed. */
const POSSESSIVE: Record<string, string> = {
  mijn: "my",
  "m'n": "my",
  jouw: "your",
  je: "your",
  uw: "your",
  zijn: "his",
  "z'n": "his",
  haar: "her",
  "d'r": "her",
  ons: "our",
  onze: "our",
  jullie: "your",
  hun: "their",
};

/** Words that mean "very" right before an adjective or adverb ("heel mooi", "heel veel"). */
const INTENSIFIER: Record<string, string> = { heel: "very", hele: "very" };
/** What an intensifier can stand before. */
const INTENSIFIED_POS = new Set(["ADJ", "ADV"]);
const INTENSIFIED_LEMMA = new Set(["veel", "weinig", "goed", "graag", "erg"]);

/** A diminutive's singular form: "bankje", "bankjes" → "bankje"; null for other words. */
function diminutive(surface: string): string | null {
  const w = surface.toLocaleLowerCase("nl");
  const one = w.endsWith("jes") ? w.slice(0, -1) : w;
  return one.length > 3 && one.endsWith("je") ? one : null;
}

export interface ContextGloss {
  /** The meaning here, fixed by the grammar (possessives, "very"): use it as it is. */
  fixed?: string;
  /** Look this form up in the dictionary instead of the lemma (a name, a diminutive). */
  lemma?: string;
  /**
   * The card matched by lemma is another word here (a name, a diminutive, a possessive): its
   * meaning must not stand for this one.
   */
  notTheCard: boolean;
}

/** How to find the meaning of `t` (at `tokens[t.i]`) in its sentence. */
export function contextGloss(tokens: readonly AnalyzedToken[], t: AnalyzedToken): ContextGloss {
  const surface = t.text.toLocaleLowerCase("nl");
  if (/\bPoss=Yes\b/.test(t.morph ?? "") && POSSESSIVE[surface])
    return { fixed: POSSESSIVE[surface], notTheCard: true };
  const intensifier = INTENSIFIER[surface];
  if (intensifier) {
    const next = tokens.slice(t.i + 1).find((x) => x.is_word);
    if (
      next &&
      next.sent === t.sent &&
      (INTENSIFIED_POS.has(next.pos) || INTENSIFIED_LEMMA.has(next.lemma))
    )
      return { fixed: intensifier, notTheCard: true };
  }
  if (t.pos === "PROPN" || t.is_propn)
    return { lemma: t.text, notTheCard: t.text.toLocaleLowerCase("nl") !== t.lemma };
  if (t.pos === "NOUN") {
    const small = diminutive(t.text);
    if (small && small !== t.lemma.toLocaleLowerCase("nl"))
      return { lemma: small, notTheCard: true };
  }
  return { notTheCard: false };
}

/** A card or dictionary meaning without a leading article: "a garden, yard" → "garden, yard". */
export function withoutArticle(gloss: string): string {
  return gloss.replace(/^(?:an?|the)\s+(?=\p{L})/iu, "");
}
