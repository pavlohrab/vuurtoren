/**
 * How many other words of a sentence the learner doesn't know (docs/dev/algorithms.md 4.7.4), so
 * a lesson can prefer sentences made of known words. A word counts as known when the learner
 * model knows it (recall 0.8 or more, tried as written and with common Dutch endings taken off)
 * or when it is one of the small words every sentence has. Pure.
 */

/** Small, very common words: articles, pronouns, prepositions, the commonest verbs. */
export const FUNCTION_WORDS: ReadonlySet<string> = new Set(
  (
    "de het een en of maar dat die dit deze wat wie waar hoe als dan om te in op aan bij met " +
    "van voor naar uit over onder door tot na zonder tegen niet geen wel ook nog al er hier " +
    "daar nu toen zo heel erg veel meer minder ik je jij u hij zij ze wij we jullie mij me " +
    "hem haar ons hun mijn jouw zijn uw onze is ben bent was waren zijn heb hebt heeft had " +
    "hadden hebben wordt worden werd kan kun kunt kon wil wilt wilde moet moest zal zullen " +
    "zou ga gaat ging gaan doe doet deed doen ja nee"
  ).split(" "),
);

/** Endings tried when a form isn't in the model as written. */
const ENDINGS = ["en", "e", "t", "s", "je", "jes", "te", "ten", "de", "den", "er", "st"];

/** The ways a written form might appear in the model. */
export function formsOf(word: string): string[] {
  const w = word.toLowerCase();
  const out = [w];
  for (const end of ENDINGS)
    if (w.length > end.length + 2 && w.endsWith(end)) {
      const stem = w.slice(0, -end.length);
      out.push(stem, `${stem}en`);
      // A doubled vowel loses one before -en (loopt → lopen); a consonant doubles (zit → zitten).
      const m = /^(.*?)([aeou])\2([^aeiou])$/.exec(stem);
      if (m) out.push(`${m[1]}${m[2]}${m[3]}en`);
      if (/[^aeiou][aeiou][^aeiou]$/.test(stem)) out.push(`${stem}${stem.at(-1)}en`);
    }
  return out;
}

/** Words of the sentence, outside the target span, that the learner doesn't know. */
export function unknownOthers(
  text: string,
  target: readonly [number, number],
  known: (form: string) => boolean,
): number {
  let n = 0;
  for (const m of text.matchAll(/\p{L}+/gu)) {
    const at = m.index ?? 0;
    if (at >= target[0] && at < target[1]) continue;
    const w = m[0].toLowerCase();
    if (FUNCTION_WORDS.has(w)) continue;
    if (!formsOf(w).some(known)) n++;
  }
  return n;
}
