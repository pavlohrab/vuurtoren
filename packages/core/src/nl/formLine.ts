/**
 * The line under the card's head (RD2): the word as the page has it, and what kind of form it is,
 * in plain words. The head is the dictionary word (moeten); this line says "moet · present,
 * hij/zij/het". A split verb shows both parts ("doet … open"). Worked out from the token's
 * morphology and its subject, no new data.
 */
import type { AnalyzedToken } from "../reading/types.js";

export interface FormLine {
  /** The word as the page has it: "moet", "doet … open". */
  said: string;
  /** What kind of form: "present, hij/zij/het", "plural". Missing when there is nothing to say. */
  what?: string;
}

const SUBJECT_PRONOUNS = new Set([
  "ik",
  "jij",
  "je",
  "u",
  "hij",
  "zij",
  "ze",
  "het",
  "wij",
  "we",
  "jullie",
  "men",
]);

const feat = (morph: string, name: string): string | undefined =>
  morph
    .split("|")
    .find((f) => f.startsWith(`${name}=`))
    ?.slice(name.length + 1);

/** Who does it: the subject pronoun when there is one, else the person the number gives. */
function who(tokens: readonly AnalyzedToken[], verb: AnalyzedToken): string {
  const subject = tokens.find(
    (t) => t.head === verb.i && t.i !== verb.i && t.dep.startsWith("nsubj"),
  );
  const word = subject?.text.toLowerCase();
  if (word && SUBJECT_PRONOUNS.has(word)) return word;
  return feat(verb.morph, "Number") === "Plur" ? "wij/jullie/zij" : "hij/zij/het";
}

/**
 * A command ("Kijk!", "Doe de deur dicht."): the parser calls it a present-tense verb, so word
 * order decides. The sentence's first word, a singular present with no subject of its own, in
 * its bare stem (kijk, not kijkt; wacht, whose stem ends in t, also counts).
 */
function isCommand(tokens: readonly AnalyzedToken[], t: AnalyzedToken): boolean {
  if (feat(t.morph, "Tense") !== "Pres" || feat(t.morph, "Number") === "Plur") return false;
  const first = tokens.find((x) => x.sent === t.sent && x.is_word);
  if (first?.i !== t.i) return false;
  if (tokens.some((x) => x.head === t.i && x.i !== t.i && x.dep.startsWith("nsubj"))) return false;
  const word = t.text.toLowerCase();
  const stem = t.lemma.toLowerCase().replace(/e?n$/, "");
  return !word.endsWith("t") || stem.endsWith("t");
}

function verbForm(tokens: readonly AnalyzedToken[], t: AnalyzedToken): string | undefined {
  const form = feat(t.morph, "VerbForm");
  if (form === "Part") return "past participle";
  if (form !== "Fin") return undefined;
  if (isCommand(tokens, t)) return "command";
  const tense = feat(t.morph, "Tense") === "Past" ? "past" : "present";
  return `${tense}, ${who(tokens, t)}`;
}

function otherForm(t: AnalyzedToken): string | undefined {
  if (t.pos === "NOUN") {
    if (/(je|jes)$/.test(t.text.toLowerCase()) && !/je$/.test(t.lemma)) return "small";
    return feat(t.morph, "Number") === "Plur" ? "plural" : undefined;
  }
  if (t.pos === "ADJ") {
    const degree = feat(t.morph, "Degree");
    if (degree === "Cmp") return "comparative";
    if (degree === "Sup") return "superlative";
  }
  return undefined;
}

/** The form line for token `i`, or null when the page's word is the dictionary word. */
export function formLine(tokens: readonly AnalyzedToken[], i: number): FormLine | null {
  let t = tokens[i];
  if (!t) return null;
  // A tapped particle ("open" of "doet … open") speaks for its verb.
  if (t.particle_of != null && tokens[t.particle_of]) t = tokens[t.particle_of]!;
  const particle = tokens.find((p) => p.particle_of === t!.i);
  const said = particle ? `${t.text} … ${particle.text}` : t.text;
  if (!particle && said.toLowerCase() === t.lemma.toLowerCase()) return null;
  const what = t.pos === "VERB" || t.pos === "AUX" ? verbForm(tokens, t) : otherForm(t);
  return what ? { said, what } : { said };
}
