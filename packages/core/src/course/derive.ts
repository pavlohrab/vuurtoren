/**
 * Derived answers for gap-fill exercises with a lemma hint: `Anne _____ (wonen) in Nijmegen.`
 * The subject is found from the parse of the sentence with the blank filled by the lemma
 * (spaCy: the `nsubj` of the blank's token, plus conjuncts) or, without a parse, from simple
 * rules; the tense from the instruction and cue words; the form from `/forms`.
 * Everything is pure; the service layer supplies the parse and the forms.
 */
import type { WordForms } from "../practice/types.js";

export type Person = "ik" | "jij" | "hij" | "wij" | "jullie" | "zij";
export type Tense = "present" | "past" | "perfect" | "infinitive";

/** The subject of the blank's verb, with how sure we are. */
export interface SubjectGuess {
  person: Person;
  /** The subject follows the verb (question / inversion): "Hoe heet jij?". */
  inverted: boolean;
  /** A second reading when the surface is ambiguous (zij/ze: she or they). */
  alt?: Person;
  confidence: number;
}

/** Minimal token shape of `/analyze/text` that the subject detection needs. */
export interface ParseToken {
  i: number;
  text: string;
  lemma: string;
  pos: string;
  morph: string;
  dep: string;
  head: number;
  start: number;
  is_word: boolean;
}

const BLANK_RE = /_{2,}|…{1,}|\.{4,}|-{4,}|—+/u;
const BLANK_GLOBAL = /_{2,}|…+|\.{4,}|-{4,}|—+/gu;
/** Placeholder-filled sentence for the parser. */
export interface PlaceholderSentence {
  text: string;
  /** Character offset of the placeholder in `text`. */
  offset: number;
}

/** True if the text contains a blank marker. */
export function hasBlank(text: string): boolean {
  return BLANK_RE.test(text);
}

/** Replace the first blank by `fill` (and later blanks by `…`), for parsing. */
export function placeholderSentence(prompt: string, fill: string): PlaceholderSentence | null {
  const m = new RegExp(BLANK_RE.source, "u").exec(prompt);
  if (!m) return null;
  const rest = prompt.slice(m.index + m[0].length).replace(BLANK_GLOBAL, "dat");
  // Remove the "(hint)" next to the blank, which the parser should not see.
  const cleaned = rest.replace(/^\s*\([^)]*\)/, "");
  return { text: prompt.slice(0, m.index) + fill + cleaned, offset: m.index };
}

const PRONOUN: Record<string, { person: Person; alt?: Person; confidence: number }> = {
  ik: { person: "ik", confidence: 1 },
  jij: { person: "jij", confidence: 1 },
  je: { person: "jij", confidence: 0.95 },
  u: { person: "hij", confidence: 0.95 },
  hij: { person: "hij", confidence: 1 },
  het: { person: "hij", confidence: 0.9 },
  men: { person: "hij", confidence: 0.9 },
  wij: { person: "wij", confidence: 1 },
  we: { person: "wij", confidence: 1 },
  jullie: { person: "jullie", confidence: 1 },
  zij: { person: "hij", alt: "zij", confidence: 0.6 },
  ze: { person: "hij", alt: "zij", confidence: 0.6 },
};

/** Persons of a coordinated subject ("Willem en Mila") are plural; "jij en ik" is "wij". */
function plural(persons: readonly (Person | "other")[]): Person {
  if (persons.includes("ik")) return "wij";
  if (persons.includes("jij") || persons.includes("jullie")) return "jullie";
  return "zij";
}

/**
 * Subject from a parse of the placeholder sentence. Finds the token at `offset` (the filled
 * blank) and its `nsubj` dependent; conjuncts make it plural.
 */
export function subjectFromParse(
  tokens: readonly ParseToken[],
  offset: number,
): SubjectGuess | null {
  const verb = tokens.find((t) => t.is_word && t.start === offset);
  if (!verb) return null;
  const subj = tokens.find((t) => t.head === verb.i && t.i !== verb.i && t.dep.startsWith("nsubj"));
  if (!subj) return null;
  const inverted = subj.start > verb.start;
  const conj = tokens.filter((t) => t.head === subj.i && t.dep === "conj");
  const own = PRONOUN[subj.text.toLowerCase()];
  if (conj.length > 0) {
    const all = [subj, ...conj].map((t) => PRONOUN[t.text.toLowerCase()]?.person ?? "other");
    return { person: plural(all), inverted, confidence: 0.9 };
  }
  if (subj.pos === "PRON" && own) {
    return {
      person: own.person,
      inverted,
      confidence: own.confidence,
      ...(own.alt && { alt: own.alt }),
    };
  }
  if (/Number=Plur/.test(subj.morph)) return { person: "zij", inverted, confidence: 0.85 };
  if (subj.pos === "NOUN" || subj.pos === "PROPN") {
    return { person: "hij", inverted, confidence: subj.pos === "PROPN" ? 0.9 : 0.8 };
  }
  return null;
}

const WORD_RE = /[\p{L}'’]+/gu;
const words = (s: string): string[] => s.match(WORD_RE) ?? [];

/**
 * Subject without a parse: the words before the blank (or, when the blank opens the clause as in
 * questions, the words right after it). A noun phrase joined by "en" is plural; a lone name or
 * noun is third person singular with lower confidence.
 */
export function subjectByRules(before: string, after: string): SubjectGuess | null {
  const b = words(before.replace(/^.*[.!?;:]\s*/, ""));
  // Drop leading question words and conjunctions: "Hoe", "Waar", "Wat", "En", "Maar".
  const lead = new Set([
    "hoe",
    "waar",
    "wat",
    "wie",
    "wanneer",
    "waarom",
    "welke",
    "en",
    "maar",
    "ja",
    "nee",
    "dus",
    "ook",
    "gisteren",
    "vandaag",
    "morgen",
    "nu",
    "dan",
    "daarna",
    "toen",
    "vroeger",
    "later",
    "soms",
    "meestal",
    "altijd",
    "vanavond",
    "vanochtend",
    "vanmiddag",
    "hier",
    "daar",
    "thuis",
    "nooit",
    "vaak",
    "misschien",
    "straks",
    "eerst",
    "eergisteren",
    "overmorgen",
    "tegenwoordig",
  ]);
  while (b.length > 0 && lead.has((b[0] ?? "").toLowerCase()) && b.length > 0) b.shift();
  const subjectWords = b.length > 0 ? b : words(after).slice(0, 4);
  const inverted = b.length === 0;
  if (subjectWords.length === 0) return null;
  const lower = subjectWords.map((w) => w.toLowerCase());
  const conj = lower.indexOf("en");
  if (conj > 0 && conj < lower.length - 1) {
    const sides = [lower.slice(0, conj), lower.slice(conj + 1)];
    const persons = sides.map((s) => PRONOUN[s[s.length - 1] ?? ""]?.person ?? "other");
    return { person: plural(persons), inverted, confidence: 0.75 };
  }
  // Pronoun directly before the blank, or right after it when inverted.
  const pick = inverted ? lower[0] : lower[lower.length - 1];
  const p = pick ? PRONOUN[pick] : undefined;
  if (p)
    return { person: p.person, inverted, confidence: p.confidence, ...(p.alt && { alt: p.alt }) };
  const head = subjectWords[inverted ? 0 : subjectWords.length - 1] ?? "";
  if (/^\p{Lu}/u.test(head) && (inverted || subjectWords.length === 1)) {
    return { person: "hij", inverted, confidence: 0.7 };
  }
  // A noun phrase of unknown number: assume singular, flag it.
  return { person: "hij", inverted, confidence: 0.45 };
}

const MODALS = new Set([
  "wil",
  "wilt",
  "willen",
  "kan",
  "kunt",
  "kun",
  "kunnen",
  "moet",
  "moeten",
  "mag",
  "mogen",
  "zal",
  "zult",
  "zullen",
  "ga",
  "gaat",
  "gaan",
  "laat",
  "laten",
  "durf",
  "hoef",
  "hoeft",
  "hoeven",
]);
const AUX = new Set([
  "heb",
  "hebt",
  "heeft",
  "hebben",
  "had",
  "hadden",
  "ben",
  "bent",
  "is",
  "zijn",
  "was",
  "waren",
]);
const PAST_CUES =
  /\b(gisteren|eergisteren|vroeger|toen|geleden|vorige|vorig|vanochtend geleden|in 19\d\d|in 200\d)\b/i;

/**
 * Tense of the blank. The instruction decides when it names a tense; otherwise cue words:
 * a modal or "te" before the blank asks for the infinitive, an auxiliary for the participle,
 * past-time words for the simple past.
 */
export function detectTense(
  instruction: string,
  before: string,
  after: string,
): { tense: Tense; confidence: number } {
  const prev = words(before).map((w) => w.toLowerCase());
  const last = prev[prev.length - 1];
  if (last === "te") return { tense: "infinitive", confidence: 0.9 };
  if (prev.some((w) => MODALS.has(w)) && !prev.some((w) => AUX.has(w))) {
    return { tense: "infinitive", confidence: 0.85 };
  }
  const afterWords = words(after);
  if (prev.some((w) => AUX.has(w)) && afterWords.length <= 1) {
    return { tense: "perfect", confidence: 0.75 };
  }
  if (/\b(imperfectum|verleden tijd|onvoltooid)\b/i.test(instruction)) {
    return { tense: "past", confidence: 0.9 };
  }
  if (/\b(perfectum|voltooid)/i.test(instruction)) return { tense: "perfect", confidence: 0.9 };
  if (PAST_CUES.test(before) || PAST_CUES.test(after)) return { tense: "past", confidence: 0.75 };
  if (/\b(presens|tegenwoordige)/i.test(instruction)) return { tense: "present", confidence: 0.95 };
  return { tense: "present", confidence: 0.95 };
}

export interface DerivedAnswer {
  answer?: string;
  /** Other acceptable answers (the other reading of "zij", the separable particle variant). */
  accept?: string[];
  confidence: number;
  tense?: Tense;
}

const SG: Person[] = ["ik", "jij", "hij"];

/** The finite form of a verb for `person` in `tense` (null when the data lacks it). */
export function conjugate(
  forms: WordForms,
  person: Person,
  tense: Tense,
  inverted: boolean,
  lemma: string,
): string | null {
  switch (tense) {
    case "infinitive":
      return lemma;
    case "perfect":
      return forms.participle ?? null;
    case "past":
      return forms.past ? (SG.includes(person) ? forms.past[0] : forms.past[1]) : null;
    case "present": {
      if (!forms.present) return null;
      // Inversion drops the -t of "jij": "Woon jij ...?" (Wiktionary lists the dictionary form "woont").
      if (person === "jij" && inverted) return forms.present.ik ?? forms.present.jij ?? null;
      return forms.present[person] ?? null;
    }
  }
}

/** For a separable verb, the particle that stands at the end of the clause, if present there. */
function stripParticle(form: string, forms: WordForms, after: string): string {
  const particle = forms.separable?.particle;
  if (!particle) return form;
  const present = words(after).some((w) => w.toLowerCase() === particle);
  return present && form.endsWith(` ${particle}`) ? form.slice(0, -particle.length - 1) : form;
}

/**
 * Derive the answer for one blank.
 *
 * @param before text before the blank (same sentence)
 * @param after text after the blank, without the "(hint)"
 * @param hint the lemma in brackets
 * @param forms Wiktionary morphology of the lemma (from `/forms`)
 * @param subject parse- or rule-based subject (pass the better one)
 */
export function deriveGapAnswer(opts: {
  instruction: string;
  before: string;
  after: string;
  hint: string;
  forms: WordForms | undefined;
  subject: SubjectGuess | null;
}): DerivedAnswer {
  const { forms, subject, hint, instruction } = opts;
  if (!forms || Object.keys(forms).length === 0) return { confidence: 0 };
  // Non-verbs: plural / diminutive / comparison asked in the instruction.
  if (!forms.present && !forms.past && !forms.participle) {
    const pick = /meervoud|pluralis/i.test(instruction)
      ? forms.plural
      : /verkleinwoord|diminutief/i.test(instruction)
        ? forms.diminutive
        : /superlatief/i.test(instruction)
          ? forms.superlative
          : /comparatief|vergrot/i.test(instruction)
            ? forms.comparative
            : undefined;
    return pick ? { answer: pick, confidence: 0.7 } : { confidence: 0 };
  }
  const { tense, confidence: tenseConf } = detectTense(instruction, opts.before, opts.after);
  const guess: SubjectGuess = subject ?? { person: "hij", inverted: false, confidence: 0.3 };
  const needsSubject = tense === "present" || tense === "past";
  const answer = conjugate(forms, guess.person, tense, guess.inverted, hint);
  if (!answer) return { confidence: 0 };
  const result: DerivedAnswer = {
    answer:
      tense === "present" || tense === "past" ? stripParticle(answer, forms, opts.after) : answer,
    tense,
    confidence: Math.round(Math.min(tenseConf, needsSubject ? guess.confidence : 1) * 100) / 100,
  };
  const accept: string[] = [];
  if (guess.alt && needsSubject) {
    const other = conjugate(forms, guess.alt, tense, guess.inverted, hint);
    if (other) accept.push(stripParticle(other, forms, opts.after));
  }
  if (forms.separable && result.answer !== answer) accept.push(answer);
  const unique = accept.filter((a, i) => a !== result.answer && accept.indexOf(a) === i);
  if (unique.length) result.accept = unique;
  return result;
}
