/**
 * Exercise generators. Each returns an Exercise or null when the word lacks the data the
 * kind needs. Pure: all randomness comes from the injected rng.
 */
import { distractors } from "./distractors.js";
import { pick, shuffle, type Rng } from "./rng.js";
import { rankSentences, targetSurface, wordCount } from "./sentences.js";
import {
  SKILL_OF,
  type Exercise,
  type ExampleSentence,
  type ExerciseKind,
  type WordData,
} from "./types.js";

/** Minimum number of wrong options for a choice exercise (so at least 3 choices). */
const MIN_DISTRACTORS = 2;
const BLANK = "____";

type Generator = (word: WordData, pool: readonly WordData[], rng: Rng) => Exercise | null;

/** Shared skeleton: id, kind, skill, key. */
function base(
  kind: ExerciseKind,
  word: WordData,
  rng: Rng,
  rest: Omit<Exercise, "id" | "kind" | "skill" | "key">,
): Exercise {
  const id = `${kind}:${word.key}:${Math.floor(rng() * 36 ** 6).toString(36)}`;
  return { id, kind, skill: SKILL_OF[kind], key: word.key, ...rest };
}

const withArticle = (w: WordData) =>
  w.pos === "NOUN" && w.article ? `${w.article} ${w.lemma}` : w.lemma;
const capitalize = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const lowerFirst = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s);

/** Cloze prompt fields for a sentence: blanked text, original sentence, span, translation. */
function clozePrompt(s: ExampleSentence): Exercise["prompt"] {
  const prompt: Exercise["prompt"] = {
    text: s.text.slice(0, s.target[0]) + BLANK + s.text.slice(s.target[1]),
    sentence: s.text,
    blank: [s.target[0], s.target[1]],
  };
  if (s.translation) prompt.translation = s.translation;
  return prompt;
}

/** Case-insensitive whole-word occurrences of `surface` in `text`. */
function occurrences(text: string, surface: string): number {
  const esc = surface.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, "giu"))]
    .length;
}

/**
 * Best sentence for a cloze: ranked like rankSentences, but sentences where the target surface
 * occurs more than once are skipped (the other copy would give the answer away).
 */
function clozeSentence(word: WordData): ExampleSentence | undefined {
  return rankSentences(word.sentences).find((s) => occurrences(s.text, targetSurface(s)) === 1);
}

/** meaning-choice: "de hond" -> four English glosses (answer = first gloss). */
const meaningChoice: Generator = (word, pool, rng) => {
  const gloss = word.glosses[0];
  if (!gloss) return null;
  const wrong = distractors(word, pool, 3, rng, "gloss");
  if (wrong.length < MIN_DISTRACTORS) return null;
  return base("meaning-choice", word, rng, {
    instruction: "Choose the meaning",
    prompt: { text: withArticle(word) },
    choices: shuffle([gloss, ...wrong], rng),
    answer: gloss,
  });
};

/** word-choice: English gloss -> four Dutch lemmas. */
const wordChoice: Generator = (word, pool, rng) => {
  const gloss = word.glosses[0];
  if (!gloss) return null;
  const wrong = distractors(word, pool, 3, rng, "lemma");
  if (wrong.length < MIN_DISTRACTORS) return null;
  return base("word-choice", word, rng, {
    instruction: `Which Dutch word means “${gloss}”?`,
    prompt: { text: gloss },
    choices: shuffle([word.lemma, ...wrong], rng),
    answer: word.lemma,
  });
};

/**
 * cloze-choice: choices are the sentence's surface form plus distractor lemmas
 * (naive: distractors are not inflected, so an inflected answer may stand out; the
 * distractor is capitalised when the blank starts a sentence).
 */
const clozeChoice: Generator = (word, pool, rng) => {
  const s = clozeSentence(word);
  if (!s) return null;
  const surface = targetSurface(s);
  const wrong = distractors(word, pool, 3, rng, "lemma");
  if (wrong.length < MIN_DISTRACTORS) return null;
  const upper = surface[0] !== surface[0]?.toLowerCase();
  const options = wrong.map((w) => (upper ? capitalize(w) : w));
  return base("cloze-choice", word, rng, {
    instruction: "Choose the missing word",
    prompt: clozePrompt(s),
    choices: shuffle([surface, ...options], rng),
    answer: surface,
  });
};

/** cloze-typed: type the surface form; the English gloss is the hint. */
const clozeTyped: Generator = (word, _pool, rng) => {
  const s = clozeSentence(word);
  if (!s) return null;
  const prompt = clozePrompt(s);
  if (word.glosses[0]) prompt.hint = word.glosses[0];
  return base("cloze-typed", word, rng, {
    instruction: "Fill in the missing word",
    prompt,
    answer: targetSurface(s),
  });
};

/** Gender rules shown after answering; only used when they agree with the real article. */
function genderExplanation(word: WordData): string {
  const { lemma, article } = word;
  if (article === "het" && /je$/.test(lemma)) return "Diminutives (-je) are always het.";
  if (article === "het" && /(ment|isme)$/.test(lemma))
    return "Nouns ending in -ment or -isme are het.";
  if (article === "de" && /(heid|teit|ing|ie|schap)$/.test(lemma)) {
    return "Nouns ending in -heid, -teit, -ing, -ie or -schap are almost always de.";
  }
  const plural = "Plurals always take de.";
  return `${article} ${lemma}: the gender has to be learned with the word. ${plural}`;
}

/** gender: de or het? */
const gender: Generator = (word, _pool, rng) => {
  if (word.pos !== "NOUN" || !word.article) return null;
  return base("gender", word, rng, {
    instruction: "de or het?",
    prompt: { text: word.lemma },
    choices: ["de", "het"],
    answer: word.article,
    explanation: genderExplanation(word),
  });
};

/** Letters-only form of a whitespace token (strip sentence punctuation around it). */
const FINAL_PUNCT = /[.!?…]+$/u;

/**
 * Build wrong versions of a sentence containing a split separable verb.
 * Words are whitespace tokens; final punctuation is detached and re-attached.
 * Variants: unsplit ("Ik opbel hem"), particle right before the verb ("Ik op bel hem"),
 * particle right after the verb ("Ik bel op hem"). Returns [] when the sentence has no
 * particle token after the verb.
 */
function separableVariants(s: ExampleSentence, particle: string): string[] {
  const tail = FINAL_PUNCT.exec(s.text.trimEnd())?.[0] ?? "";
  const words = [...s.text.trimEnd().matchAll(/\S+/g)].map((m) => ({
    text: m[0],
    start: m.index ?? 0,
  }));
  const cores = words.map((w) => w.text);
  const last = cores.length - 1;
  if (last >= 0) cores[last] = cores[last]!.slice(0, cores[last]!.length - tail.length);
  const v = words.findIndex((w) => w.start <= s.target[0] && s.target[0] < w.start + w.text.length);
  const p = cores.findIndex((c, i) => i > v && c.toLowerCase() === particle.toLowerCase());
  if (v < 0 || p < 0) return [];

  const join = (parts: string[]) => parts.join(" ") + tail;
  const verb = cores[v]!;
  const part = cores[p]!;
  const without = cores.filter((_, i) => i !== p);
  const initial = v === 0; // sentence-initial verb: move the capital to the new first word
  const unsplit = [...without];
  unsplit[v] = initial ? capitalize(particle) + lowerFirst(verb) : particle + verb;
  const early = [...without];
  early.splice(v, 1, initial ? capitalize(part) : part, initial ? lowerFirst(verb) : verb);
  const after = [...without];
  after.splice(v + 1, 0, part);
  return [join(unsplit), join(early), join(after)];
}

/**
 * separable: "Choose the correct sentence" among the real sentence and wrong builds
 * (see separableVariants). Needs a sentence where the particle stands apart after the verb.
 */
const separable: Generator = (word, _pool, rng) => {
  const sep = word.forms?.separable;
  if (word.pos !== "VERB" || !sep) return null;
  for (const s of rankSentences(word.sentences)) {
    const answer = s.text.trim();
    const seen = new Set([answer.toLowerCase()]);
    const wrong: string[] = [];
    for (const v of separableVariants(s, sep.particle)) {
      if (!seen.has(v.toLowerCase())) {
        seen.add(v.toLowerCase());
        wrong.push(v);
      }
    }
    if (wrong.length < MIN_DISTRACTORS) continue;
    const prompt: Exercise["prompt"] = { text: word.lemma };
    if (s.translation) prompt.translation = s.translation;
    if (word.glosses[0]) prompt.hint = word.glosses[0];
    return base("separable", word, rng, {
      instruction: "Choose the correct sentence",
      prompt,
      choices: shuffle([answer, ...wrong], rng),
      answer,
      explanation: `${word.lemma} is separable: in a main clause the particle "${sep.particle}" goes to the end.`,
    });
  }
  return null;
};

const PERFECT_SUBJECTS = [
  { subject: "ik", hebben: "heb", zijn: "ben" },
  { subject: "hij", hebben: "heeft", zijn: "is" },
  { subject: "wij", hebben: "hebben", zijn: "zijn" },
] as const;

/** perfect: "Ik ____ (lezen) - perfect tense" -> "heb gelezen" (typed). */
const perfect: Generator = (word, _pool, rng) => {
  const participle = word.forms?.participle;
  const aux = word.forms?.aux;
  if (word.pos !== "VERB" || !participle || !aux) return null;
  const subj = pick(PERFECT_SUBJECTS, rng)!;
  const primary = aux === "zijn" ? "zijn" : "hebben";
  const answer = `${subj[primary]} ${participle}`;
  const prompt: Exercise["prompt"] = {
    text: `${capitalize(subj.subject)} ${BLANK} (${word.lemma}) — perfect tense`,
  };
  if (word.glosses[0]) prompt.hint = word.glosses[0];
  const explanations = {
    zijn: "zijn: verbs of motion to a destination and of change of state take zijn.",
    hebben: "hebben is the default auxiliary: most verbs, and almost all with an object, use it.",
    both: "Both hebben and zijn occur; zijn stresses motion or change, hebben the activity.",
  } as const;
  const ex = base("perfect", word, rng, {
    instruction: "Complete the perfect tense",
    prompt,
    answer,
    explanation: explanations[aux],
  });
  if (aux === "both") ex.accept = [`${subj.zijn} ${participle}`];
  return ex;
};

type VerbSlot = { label: string; tense: "past" | "present"; person: string; form: string };

/** All filled-in verb slots of a word. */
function verbSlots(word: WordData): VerbSlot[] {
  const f = word.forms;
  const out: VerbSlot[] = [];
  if (f?.past) {
    out.push({ label: "past", tense: "past", person: "ik", form: f.past[0] });
    out.push({ label: "past", tense: "past", person: "wij", form: f.past[1] });
  }
  for (const [person, form] of Object.entries(f?.present ?? {})) {
    if (form) out.push({ label: "present", tense: "present", person, form });
  }
  return out;
}

/** verb-form: random filled slot, typed: "Put the verb in the past tense: lopen" / "wij ____". */
const verbForm: Generator = (word, _pool, rng) => {
  const slot = pick(verbSlots(word), rng);
  if (word.pos !== "VERB" || !slot) return null;
  const prompt: Exercise["prompt"] = { text: `${slot.person} ${BLANK}` };
  if (word.glosses[0]) prompt.hint = word.glosses[0];
  return base("verb-form", word, rng, {
    instruction: `Put the verb in the ${slot.tense} tense: ${word.lemma}`,
    prompt,
    answer: slot.form,
  });
};

/**
 * Adjective templates. Rule: an adjective takes -e, except directly after "een" before a
 * het-word (een mooi huis). Definite article + het-word (het mooie huis) and all de-words
 * (een mooie man, de mooie man) take -e.
 */
const ADJECTIVE_TEMPLATES = [
  { text: `een ${BLANK} huis`, inflect: false, why: "een + het-word: no -e" },
  { text: `het ${BLANK} huis`, inflect: true, why: "definite (het/de): -e" },
  { text: `een ${BLANK} man`, inflect: true, why: "de-word: -e" },
  { text: `de ${BLANK} man`, inflect: true, why: "definite (het/de): -e" },
] as const;

/** adjective-e: choose between base and inflected form in a small template. */
const adjectiveE: Generator = (word, _pool, rng) => {
  const inflected = word.forms?.inflected;
  if (word.pos !== "ADJ" || !inflected || inflected === word.lemma) return null;
  const t = pick(ADJECTIVE_TEMPLATES, rng)!;
  const answer = t.inflect ? inflected : word.lemma;
  const prompt: Exercise["prompt"] = { text: t.text };
  if (word.glosses[0]) prompt.hint = word.glosses[0];
  return base("adjective-e", word, rng, {
    instruction: "Choose the correct form of the adjective",
    prompt,
    choices: shuffle([word.lemma, inflected], rng),
    answer,
    explanation: `${t.why}: ${t.text.replace(BLANK, answer)}.`,
  });
};

const SCRAMBLE_MIN = 4;
const SCRAMBLE_MAX = 9;

/** scramble: 4-9 word sentence; last punctuation detached; shuffled until the order differs. */
const scramble: Generator = (word, _pool, rng) => {
  const s = rankSentences(word.sentences, SCRAMBLE_MIN, SCRAMBLE_MAX).find((x) => {
    const n = wordCount(x.text);
    return n >= SCRAMBLE_MIN && n <= SCRAMBLE_MAX;
  });
  if (!s) return null;
  const text = s.text.trim().replace(/\s+/g, " ");
  const words = text.split(" ");
  const pieces = words.map((w, i) => (i === words.length - 1 ? w.replace(FINAL_PUNCT, "") : w));
  // The sentence-initial capital would identify the first piece; lowercase it unless the
  // word is a proper noun (or has inner capitals, e.g. an acronym).
  const first = pieces[0]!;
  const keepCase = word.pos === "PROPN" || /\p{Lu}/u.test(first.slice(1));
  if (!keepCase) pieces[0] = lowerFirst(first);
  if (new Set(pieces.map((p) => p.toLowerCase())).size < 2) return null;
  let order = shuffle(pieces, rng);
  for (let i = 0; i < 10 && order.join(" ") === pieces.join(" "); i++) order = shuffle(pieces, rng);
  if (order.join(" ") === pieces.join(" ")) order = [...pieces.slice(1), pieces[0]!];
  const prompt: Exercise["prompt"] = { text: s.translation ?? "" };
  if (s.translation) prompt.translation = s.translation;
  else if (word.glosses[0]) prompt.hint = word.glosses[0];
  return base("scramble", word, rng, {
    instruction: "Put the words in order",
    prompt,
    pieces: order,
    answer: text,
  });
};

const DICTATION_MAX_WORDS = 8;

/** dictation: speak a short sentence containing the word, else the lemma. */
const dictation: Generator = (word, _pool, rng) => {
  const s = rankSentences(word.sentences, 3, DICTATION_MAX_WORDS).find(
    (x) => wordCount(x.text) <= DICTATION_MAX_WORDS,
  );
  const speak = s ? s.text.trim() : word.lemma;
  if (!speak) return null;
  const prompt: Exercise["prompt"] = { text: "", speak };
  if (!s && word.glosses[0]) prompt.hint = word.glosses[0];
  return base("dictation", word, rng, {
    instruction: "Type what you hear",
    prompt,
    answer: speak,
  });
};

const GENERATORS: Record<ExerciseKind, Generator> = {
  "meaning-choice": meaningChoice,
  "word-choice": wordChoice,
  "cloze-choice": clozeChoice,
  "cloze-typed": clozeTyped,
  gender,
  separable,
  perfect,
  "verb-form": verbForm,
  "adjective-e": adjectiveE,
  scramble,
  dictation,
};

/**
 * Generate one exercise of `kind` for `word`, or null when the word lacks the needed data
 * (glosses, sentences, forms, enough same-POS distractors in `pool`).
 */
export function generate(
  kind: ExerciseKind,
  word: WordData,
  pool: readonly WordData[],
  rng: Rng,
): Exercise | null {
  return GENERATORS[kind](word, pool, rng);
}
