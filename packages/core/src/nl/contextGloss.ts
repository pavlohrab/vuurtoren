/**
 * A word's meaning in its sentence, not just its card's or its dictionary's first one.
 *
 * A card has one meaning and a dictionary entry several, and the reader used to take the first
 * whatever the sentence said: "zijn hond" got the verb card's "to be", "op de bank" could get
 * "bank", "vroeger" got "early". Three layers decide instead, none of them a rule per word:
 *
 * 1. The sentence (`meaningInSentence`), for content words: every sentence is translated
 *    offline and each word aligned to the English it became (made once per text, kept with it
 *    and synced to the phone). That English picks the matching meaning of the card or the
 *    dictionary; when it matches none and the aligner is sure, or the usual meaning is nowhere
 *    in the sentence's translation, the aligned English is shown, "in this sentence".
 * 2. Grammar (`contextGloss`), for the closed class the aligner cannot do: possessive
 *    determiners, by the analysis's `Poss=Yes`. A complete table, not a growing list.
 * 3. Structure: a name (PROPN) and a diminutive are words of their own, never their lemma's
 *    card ("Kampen" is not "kamp", "bankje" is not "bank").
 */
import type { AnalyzedToken } from "../reading/types.js";

/** Possessive determiners, by their form: the meaning is fixed by the grammar. */
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

/** A diminutive's singular form: "bankje", "bankjes" → "bankje"; null for other words. */
function diminutive(surface: string): string | null {
  const w = surface.toLocaleLowerCase("nl");
  const one = w.endsWith("jes") ? w.slice(0, -1) : w;
  return one.length > 3 && one.endsWith("je") ? one : null;
}

export interface ContextGloss {
  /** The meaning here, fixed by the grammar (possessives): use it as it is. */
  fixed?: string;
  /** Look this form up in the dictionary instead of the lemma (a name, a diminutive). */
  lemma?: string;
  /** The card matched by lemma is another word here: its meaning must not stand for this one. */
  notTheCard: boolean;
}

/** Grammar and structure for a token: layers 2 and 3. */
export function contextGloss(t: AnalyzedToken): ContextGloss {
  const surface = t.text.toLocaleLowerCase("nl");
  if (/\bPoss=Yes\b/.test(t.morph ?? "") && POSSESSIVE[surface])
    return { fixed: POSSESSIVE[surface], notTheCard: true };
  if (t.pos === "PROPN" || t.is_propn)
    return { lemma: t.text, notTheCard: surface !== t.lemma.toLocaleLowerCase("nl") };
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

/** Parts of speech the sentence's alignment speaks for (layer 1). */
const CONTENT_POS = new Set(["NOUN", "VERB", "ADJ", "ADV"]);
/** The alignment picks among the word's own meanings from this confidence. */
const PICK_MIN = 0.15;
/** It replaces them from this confidence (or when the usual meaning is not in the sentence). */
const REPLACE_MIN = 0.5;

/** An English word reduced to a comparable stem: "benches" → "bench", "living" → "liv". */
function stem(word: string): string {
  return word
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}]/gu, "")
    .replace(/ies$/, "y")
    .replace(/(ing|ed|es|s)$/, "")
    .replace(/e$/, "");
}

/** Words that carry no meaning of their own in a gloss ("to walk", "a house"). */
const FILLER = new Set(["to", "a", "an", "th", "of", "b", "someth", "someon"]);

/** The words of a meaning that carry it: "to walk" → ["walk"], "a house" → ["hous"]. */
function meaningWords(text: string): string[] {
  return text
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+/)
    .map(stem)
    .filter((w) => w && !FILLER.has(w));
}

/** The short alternatives of a meaning: "sofa, couch; bank" → ["sofa", "couch", "bank"]. */
function alternatives(meaning: string): string[] {
  return meaning
    .replace(/\([^)]*\)/g, " ")
    .split(/[,;:]/)
    .map((p) => withoutArticle(p.trim()))
    .filter(Boolean);
}

/** Does `english` (aligned) say the same as this alternative? */
function says(english: string, alternative: string): boolean {
  const a = meaningWords(english);
  const b = meaningWords(alternative);
  return a.length > 0 && b.length > 0 && a.every((w) => b.includes(w));
}

/** Is any alternative of `meaning` in the sentence's translation? */
function inTranslation(meaning: string, translation: string): boolean {
  const words = new Set(
    translation
      .split(/[\s,.;:!?"'’()-]+/)
      .map(stem)
      .filter(Boolean),
  );
  return alternatives(meaning).some((alt) => {
    const w = meaningWords(alt);
    return w.length > 0 && w.every((x) => words.has(x));
  });
}

export interface SentenceMeaning {
  text: string;
  /** The aligned English itself, not one of the word's listed meanings. */
  inSentence: boolean;
}

/**
 * Layer 1: the meaning of a content word in its sentence. `usual` is what would show without
 * the sentence (the card's meaning, else the dictionary's first); `meanings` all the word's
 * meanings (card first, then the dictionary's, by part of speech). Null: keep `usual`.
 */
export function meaningInSentence(opts: {
  pos: string;
  usual: string | undefined;
  meanings: readonly string[];
  aligned: { text: string; confidence: number } | null | undefined;
  translation: string | undefined;
  /** The verb of a separable verb whose particle stands elsewhere in the sentence. */
  separable?: boolean;
}): SentenceMeaning | null {
  const { pos, usual, meanings, aligned, translation, separable = false } = opts;
  // A separable verb ("komen … langs") means more than the part the alignment sees.
  if (!CONTENT_POS.has(pos) || separable || !aligned?.text) return null;
  // One of the word's meanings is what the sentence says: show it as the sentence says it
  // ("zegt" → "says", not "to say, to tell"), so the page reads easily (m5, RD4).
  const asSaid = { text: lowerFirst(aligned.text), inSentence: false };
  if (usual && alternatives(usual).some((alt) => says(aligned.text, alt))) return asSaid;
  if (aligned.confidence >= PICK_MIN) {
    for (const m of meanings)
      for (const alt of alternatives(m)) if (says(aligned.text, alt)) return asSaid;
  }
  const strayed = !!usual && !!translation && !inTranslation(usual, translation);
  if (aligned.confidence >= REPLACE_MIN || strayed || !usual)
    return { text: lowerFirst(aligned.text), inSentence: true };
  return null;
}

/**
 * One meaning for the page, never a list: the first alternative ("child, kid" → "child",
 * "to say, to tell" → "to say"). The word sheet still shows them all.
 */
export function oneMeaning(meaning: string): string {
  return alternatives(meaning)[0] ?? meaning;
}

/** "Children" at the start of the English sentence → "children" (not "TV" or "I"). */
function lowerFirst(text: string): string {
  return /^\p{Lu}\p{Ll}/u.test(text) ? text[0]!.toLocaleLowerCase("en") + text.slice(1) : text;
}

/** Is `t` the verb of a separable verb whose particle stands elsewhere ("komen … langs")? */
export function hasDetachedParticle(tokens: readonly AnalyzedToken[], t: AnalyzedToken): boolean {
  return tokens.some((x) => x.particle_of === t.i);
}
