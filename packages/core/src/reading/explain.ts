/**
 * "Why is this word like this?" — plain-English notes on the form of any word in a text, read
 * from the stored analysis (spaCy lemma, POS, morph, dependency tree) with no server round trip.
 * Rules are listed in docs/dev/algorithms.md ("Word-form explainer").
 *
 * Precision first: every rule checks that the form agrees with what it is about to say (a weak
 * past must really be stem + -te/-de, a "-t after hij" must really end in -t, …). When a check
 * fails the explainer says less, down to just the lemma and part of speech.
 */
import type { GrammarHit } from "./grammar.js";
import type { AnalyzedToken } from "./types.js";

/** One explanation line. `topic` is a grammar page id in @app/content (absent for the plain line). */
export interface WordNote {
  /** Stable id of the rule that produced the line, e.g. "verb.past.strong". */
  key: string;
  text: string;
  topic?: string;
}

export interface WordGrammar {
  /** Notes about the word itself, most useful first (the inspector shows 1–3). */
  notes: WordNote[];
  /** Word order of the clause, only when the word is a finite verb and the order is clear. */
  order: WordNote | null;
}

export interface ExplainOptions {
  /** Grammar hits of the text (used for split pronominal adverbs such as «er … over»). */
  hits?: readonly GrammarHit[];
  /** de / het from the dictionary; preferred over the analyzer's Gender for nouns. */
  article?: string | undefined;
}

/** Every grammar page id a note can link to (checked against @app/content in the web tests). */
export const WORD_NOTE_TOPICS: readonly string[] = [
  "adjective-inflection",
  "adverbs",
  "comparison",
  "conditional",
  "conjunctions",
  "de-het",
  "demonstratives",
  "diminutives",
  "future",
  "hebben-or-zijn",
  "imperative",
  "imperfect-tense",
  "inversion",
  "irregular-verbs",
  "laten",
  "modal-verbs",
  "negation",
  "object-pronouns",
  "om-te-infinitive",
  "participles",
  "passive",
  "past-perfect",
  "perfect-tense",
  "personal-pronouns",
  "plural-nouns",
  "possessive-pronouns",
  "present-tense",
  "progressive",
  "pronominal-adverbs",
  "questions",
  "reflexive-verbs",
  "relative-pronouns",
  "separable-verbs",
  "subordinate-clauses",
  "te-infinitive",
  "word-order-v2",
];

type Tok = AnalyzedToken;

const MODALS = new Set(["kunnen", "moeten", "mogen", "willen", "zullen"]);
const MODAL_FORMS: Record<string, string> = {
  kunnen: "ik kan, jij kunt, hij kan",
  moeten: "ik moet, jij moet, hij moet",
  mogen: "ik mag, jij mag, hij mag",
  willen: "ik wil, jij wilt, hij wil",
  zullen: "ik zal, jij zult, hij zal",
};
const IRREGULAR_PRESENT: Record<string, string> = {
  zijn: "ik ben, jij bent, hij is, wij zijn",
  hebben: "ik heb, jij hebt, hij heeft, wij hebben",
  gaan: "ik ga, jij gaat, hij gaat",
  staan: "ik sta, jij staat, hij staat",
  doen: "ik doe, jij doet, hij doet",
  slaan: "ik sla, jij slaat, hij slaat",
  zien: "ik zie, jij ziet, hij ziet",
  komen: "ik kom, jij komt, hij komt",
};
/**
 * Verbs of movement: perfect with zijn when a goal is given (Ik ben naar huis gefietst), with
 * hebben for just the activity (Ik heb veel gefietst).
 */
const MOVEMENT = new Set([
  "fietsen",
  "lopen",
  "rijden",
  "zwemmen",
  "wandelen",
  "rennen",
  "vliegen",
  "varen",
  "reizen",
  "klimmen",
  "springen",
  "roeien",
  "zeilen",
  "schaatsen",
  "kruipen",
]);
/** Irregular -cht participles and pasts (denken → gedacht, kopen → gekocht). */
const IRREGULAR_CHT = /(dacht|bracht|kocht|zocht|mocht|vocht)$/;
const DEFINITE = new Set(["de", "het", "deze", "die", "dit", "dat"]);
const NO_E_DETS = new Set(["een", "geen", "elk", "ieder", "veel", "zo'n", "welk"]);
const QUESTION_WORDS = new Set([
  "wie",
  "wat",
  "waar",
  "wanneer",
  "waarom",
  "hoe",
  "welk",
  "welke",
  "hoeveel",
  "waarheen",
  "waarvandaan",
]);
const SUBJECT_EN: Record<string, string> = {
  ik: "I",
  jij: "you",
  je: "you",
  u: "you, polite",
  hij: "he",
  zij: "she / they",
  ze: "she / they",
  het: "it",
  wij: "we",
  we: "we",
  jullie: "you, plural",
};
const OBJECT_EN: Record<string, [string, string]> = {
  mij: ["ik", "me"],
  me: ["ik", "me"],
  jou: ["jij", "you"],
  je: ["jij", "you"],
  u: ["u", "you"],
  hem: ["hij", "him"],
  haar: ["zij", "her"],
  ons: ["wij", "us"],
  jullie: ["jullie", "you"],
  hen: ["zij", "them"],
  hun: ["zij", "them"],
  ze: ["zij", "her / them"],
  het: ["het", "it"],
};
const POSSESSIVE_EN: Record<string, string> = {
  mijn: "my",
  m: "my",
  jouw: "your",
  je: "your",
  uw: "your, polite",
  zijn: "his / its",
  haar: "her",
  ons: "our",
  onze: "our",
  jullie: "your, plural",
  hun: "their",
};
const UNSTRESSED: Record<string, string> = { je: "jij", ze: "zij", we: "wij", me: "mij" };
const PRONOMINAL =
  /^(er|daar|hier|waar)(aan|achter|bij|binnen|boven|buiten|door|heen|in|langs|mee|na|naar|naartoe|om|onder|op|over|tegen|tegenover|toe|tussen|uit|van|vandaan|voor|zonder|af)$/;
const PREP_FOR: Record<string, string> = { mee: "met", toe: "tot", naartoe: "naar", heen: "naar" };
const PRONOMINAL_EN: Record<string, string> = {
  er: "it",
  daar: "that",
  hier: "this",
  waar: "which / what",
};
const POS_NAME: Record<string, string> = {
  NOUN: "noun",
  PROPN: "name",
  VERB: "verb",
  AUX: "verb",
  ADJ: "adjective",
  ADV: "adverb",
  ADP: "preposition",
  PRON: "pronoun",
  DET: "determiner",
  CCONJ: "conjunction",
  SCONJ: "conjunction",
  NUM: "number",
  INTJ: "interjection",
};
/** Parts of speech that never inflect in Dutch. */
const UNCHANGING = new Set(["ADV", "ADP", "CCONJ", "SCONJ", "INTJ"]);

/** spaCy morph string → features ("Number=Sing|Tense=Past" → {Number: "Sing", Tense: "Past"}). */
export function morphFeatures(morph: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of morph.split("|")) {
    const eq = part.indexOf("=");
    if (eq > 0) out[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return out;
}

const lower = (s: string) => s.toLocaleLowerCase("nl");

/**
 * Stem spelling normalised so a past or participle root can be compared with the infinitive's
 * stem: one vowel for a long vowel before the last consonant (maak → mak), one consonant for a
 * doubled one (bell → bel), v for f and z for s (leef → lev, reis → reiz).
 */
function normStem(s: string): string {
  return s
    .replace(/(aa|ee|oo|uu)([^aeiou])$/, (_m, v: string, c: string) => `${v[0]}${c}`)
    .replace(/([^aeiou])\1$/, "$1")
    .replace(/f$/, "v")
    .replace(/s$/, "z");
}

/** The stem of an infinitive (werken → werk, bellen → bel), or null if it is not an -en verb. */
function verbStem(lemma: string): string | null {
  if (!/en$/.test(lemma) || lemma.length < 4) return null;
  return lemma.slice(0, -2).replace(/([^aeiou])\1$/, "$1");
}

/** 't kofschip: -te/-t after a stem ending in t, k, f, s, ch or p; otherwise -de/-d. */
function kofschip(stem: string): "t" | "d" {
  return /(ch|[tkfsp])$/.test(stem) ? "t" : "d";
}

/** Does `root` (a past or participle without its ending) belong to the stem of `lemma`? */
function sameStem(root: string, lemma: string): string | null {
  const stem = verbStem(lemma);
  if (!stem) return null;
  return normStem(root) === normStem(stem) ? stem : null;
}

/** Weak simple past (werkte, woonden): the ending, or null when the form is not stem + -te/-de. */
function weakPast(form: string, lemma: string): { end: "t" | "d"; stem: string } | null {
  const m = /^(.+)([td])(en?)$/.exec(form);
  if (!m) return null;
  const root = m[1] as string;
  const end = m[2] as "t" | "d";
  const stem = sameStem(root, lemma);
  if (!stem || kofschip(stem) !== end) return null;
  return { end, stem };
}

type Participle =
  | { kind: "weak"; stem: string; end: "t" | "d" | ""; ge: boolean; particle: string | null }
  | { kind: "strong" | "irregular"; ge: boolean; particle: string | null };

/** Analyse a past participle against its infinitive; null when it cannot be read with confidence. */
function participle(form: string, lemma: string): Participle | null {
  let rest = form;
  let base = lemma;
  let particle: string | null = null;
  const k = form.indexOf("ge", 2);
  if (k >= 2 && lemma.startsWith(form.slice(0, k)) && !lemma.startsWith(form.slice(0, k + 2))) {
    particle = form.slice(0, k);
    rest = form.slice(k);
    base = lemma.slice(k);
  }
  let body: string;
  let ge: boolean;
  const prefix = /^(be|ver|ont|her|ge)/.exec(base)?.[1];
  if (prefix && rest.startsWith(prefix) && !rest.startsWith(`ge${prefix}`)) {
    body = rest;
    ge = false;
  } else if (rest.startsWith("ge")) {
    body = rest.slice(2);
    ge = true;
  } else return null;
  if (!/n$/.test(base) || body.length < 2) return null;
  // gegaan, gedaan, geschreven: -n; gedacht, gekocht: irregular -cht forms.
  if (/n$/.test(body)) return { kind: "strong", ge, particle };
  if (IRREGULAR_CHT.test(body)) return { kind: "irregular", ge, particle };
  if (/[td]$/.test(body)) {
    const stem = sameStem(body.slice(0, -1), base);
    const end = body.slice(-1) as "t" | "d";
    if (stem && kofschip(stem) === end) return { kind: "weak", stem, end, ge, particle };
    // The stem may itself end in t/d (gewacht, geantwoord): nothing is added.
    const whole = sameStem(body, base);
    if (whole && /[td]$/.test(whole)) return { kind: "weak", stem: whole, end: "", ge, particle };
    return { kind: "irregular", ge, particle };
  }
  return null;
}

/** The tokens of the sentence that contains `index`. */
function sentenceAround(tokens: readonly Tok[], index: number): Tok[] {
  let p = tokens[index]?.i === index ? index : tokens.findIndex((t) => t.i === index);
  if (p < 0) return [];
  const sent = (tokens[p] as Tok).sent;
  let a = p;
  while (a > 0 && tokens[a - 1]?.sent === sent) a--;
  let b = p;
  while (b + 1 < tokens.length && tokens[b + 1]?.sent === sent) b++;
  p = a;
  return tokens.slice(p, b + 1);
}

/** Sentence view: token lookup, children and subtree tests. */
class Sentence {
  readonly byI = new Map<number, Tok>();
  constructor(readonly tokens: Tok[]) {
    for (const t of tokens) this.byI.set(t.i, t);
  }
  get(i: number): Tok | undefined {
    return this.byI.get(i);
  }
  head(t: Tok): Tok | undefined {
    return t.head === t.i ? undefined : this.byI.get(t.head);
  }
  children(t: Tok, ...deps: string[]): Tok[] {
    return this.tokens.filter(
      (c) => c.head === t.i && c.i !== t.i && (deps.length === 0 || deps.includes(c.dep)),
    );
  }
  /** Is `t` inside the subtree of `root`? */
  under(t: Tok, root: Tok): boolean {
    let cur: Tok | undefined = t;
    for (let n = 0; cur && n < 50; n++) {
      if (cur.i === root.i) return true;
      cur = this.head(cur);
    }
    return false;
  }
  words(): Tok[] {
    return this.tokens.filter(
      (t) => t.pos !== "PUNCT" && t.pos !== "SPACE" && /\p{L}|\d/u.test(t.text),
    );
  }
  /** Last punctuation mark of the sentence ("?", "!", "."), or "". */
  endMark(): string {
    for (let j = this.tokens.length - 1; j >= 0; j--) {
      const t = this.tokens[j] as Tok;
      if (/^[.?!]+$/.test(t.text)) return t.text.slice(-1);
      if (/\p{L}|\d/u.test(t.text)) return "";
    }
    return "";
  }
}

const isVerb = (t: Tok) => t.pos === "VERB" || t.pos === "AUX";

/** The separable particle of a finite verb («op» in «Ik bel je op»), if it is split off. */
function particleOf(s: Sentence, v: Tok): Tok | undefined {
  return s.tokens.find(
    (t) => t.i !== v.i && (t.particle_of === v.i || (t.dep === "compound:prt" && t.head === v.i)),
  );
}

/** The separable verb a particle and verb make together (op + bellen → opbellen). */
function separableWhole(particle: string, lemma: string): string {
  return lemma.startsWith(particle) ? lemma : particle + lemma;
}

/** The infinitive without a separable particle in front (opbellen → bellen). */
function baseLemma(lemma: string, particle: string | undefined): string {
  return particle && lemma.startsWith(particle) && lemma.length > particle.length + 2
    ? lemma.slice(particle.length)
    : lemma;
}

/** The subject of a verb: its own nsubj, or the nsubj of the verb it helps (aux/cop). */
function subjectOf(s: Sentence, v: Tok): Tok | undefined {
  const own = s.children(v, "nsubj", "nsubj:pass")[0];
  if (own) return own;
  if (["aux", "aux:pass", "cop"].includes(v.dep)) {
    const h = s.head(v);
    if (h) return s.children(h, "nsubj", "nsubj:pass")[0];
  }
  return undefined;
}

/** "form → lemma" when the lemma is a plausible dictionary form different from the word. */
function arrow(form: string, lemma: string, verb = false): string {
  const f = lower(form);
  if (f === lemma || (verb && !/n$/.test(lemma))) return form;
  return `${form} → ${lemma}`;
}

/**
 * The present perfect, with why this verb takes hebben or zijn: zijn for a change of place or
 * state (and zijn, blijven, gebeuren), hebben for the rest; movement verbs depend on a goal.
 */
function perfectNote(pair: string, aux: string, verb: string): WordNote {
  if (MOVEMENT.has(verb)) {
    return {
      key: "verb.perfect",
      text:
        aux === "zijn"
          ? `${pair}: present perfect with zijn: a movement verb takes zijn when it says where to (naar huis), hebben when it is just the activity.`
          : `${pair}: present perfect with hebben: a movement verb takes hebben for just the activity, zijn when it says where to (Ik ben naar huis ${verb === "fietsen" ? "gefietst" : "gegaan"}).`,
      topic: "hebben-or-zijn",
    };
  }
  return aux === "zijn"
    ? {
        key: "verb.perfect",
        text: `${pair}: present perfect with zijn, used for a change of place or state (gaan, komen, vertrekken, worden) and for zijn, blijven and gebeuren; most verbs take hebben.`,
        topic: "hebben-or-zijn",
      }
    : {
        key: "verb.perfect",
        text: `${pair}: present perfect (hebben + past participle at the end); most verbs take hebben, zijn is mainly for a change of place or state.`,
        topic: "perfect-tense",
      };
}

/** gaan (present) or laten + a bare infinitive (no te): near future, or "let / have done". */
function bareInfinitive(verb: Tok, inf: Tok): WordNote | null {
  const vf = morphFeatures(verb.morph);
  if (morphFeatures(inf.morph)["VerbForm"] !== "Inf") return null;
  const pair = `${verb.text} … ${inf.text}`;
  const lemma = lower(verb.lemma);
  if (lemma === "gaan" && vf["VerbForm"] === "Fin" && vf["Tense"] === "Pres") {
    return {
      key: "verb.gaan-infinitive",
      text: `${pair}: gaan + infinitive = "going to …", a plan or something about to happen; the infinitive goes to the end.`,
      topic: "future",
    };
  }
  if (lemma === "laten") {
    return {
      key: "verb.laten-infinitive",
      text: `${pair}: laten + infinitive (no te) = "let …" or "have something done" (Ik laat mijn fiets repareren).`,
      topic: "laten",
    };
  }
  return null;
}

/** The verb whose bare (no te) xcomp `v` is, if any. */
function bareXcompHead(s: Sentence, v: Tok): Tok | undefined {
  const h = s.head(v);
  return h && bareXcomp(s, h)?.i === v.i ? h : undefined;
}

/** The infinitive a verb governs without te (gaan/laten … infinitive as xcomp). */
function bareXcomp(s: Sentence, v: Tok): Tok | undefined {
  return s
    .children(v, "xcomp")
    .find(
      (c) =>
        morphFeatures(c.morph)["VerbForm"] === "Inf" &&
        !s.children(c, "mark").some((m) => lower(m.text) === "te"),
    );
}

/**
 * zijn + aan het + infinitive («Ik ben aan het koken»), found from any of its words: the
 * infinitive right after «aan het», with a form of zijn depending on it.
 */
function progressive(s: Sentence, t: Tok): WordNote | null {
  for (let k = 0; k + 2 < s.tokens.length; k++) {
    const [a, h, inf] = [s.tokens[k], s.tokens[k + 1], s.tokens[k + 2]];
    if (!a || !h || !inf || lower(a.text) !== "aan" || lower(h.text) !== "het") continue;
    if (!isVerb(inf) || morphFeatures(inf.morph)["VerbForm"] !== "Inf") continue;
    const zijn = s.tokens.find(
      (z) => z.head === inf.i && lower(z.lemma) === "zijn" && ["aux", "cop"].includes(z.dep),
    );
    if (!zijn || (t !== a && t !== h && t !== inf && t !== zijn)) continue;
    return {
      key: "verb.progressive",
      text: `${zijn.text} aan het ${inf.text}: zijn + aan het + infinitive = "busy …-ing", an action in progress.`,
      topic: "progressive",
    };
  }
  return null;
}

/** Helper-verb role of an auxiliary: perfect, passive, modal, future or conditional. */
function auxRole(aux: Tok, main: Tok): WordNote | null {
  const af = morphFeatures(aux.morph);
  const mf = morphFeatures(main.morph);
  const pair = `${aux.text} … ${main.text}`;
  if (mf["VerbForm"] === "Part") {
    if (aux.dep === "aux:pass") {
      return {
        key: "verb.passive",
        text: `${pair}: passive (${aux.lemma} + past participle): the subject undergoes the action.`,
        topic: "passive",
      };
    }
    if (aux.dep === "aux" && (aux.lemma === "hebben" || aux.lemma === "zijn")) {
      if (af["Tense"] === "Past") {
        return {
          key: "verb.past-perfect",
          text: `${pair}: past perfect (${aux.lemma} in the past + past participle).`,
          topic: "past-perfect",
        };
      }
      return perfectNote(pair, aux.lemma, lower(main.lemma));
    }
    return null;
  }
  if (mf["VerbForm"] === "Inf" && aux.dep === "aux") {
    if (aux.lemma === "zullen") {
      return af["Tense"] === "Past"
        ? {
            key: "verb.conditional",
            text: `${pair}: zou + infinitive = "would …" (conditional or polite).`,
            topic: "conditional",
          }
        : {
            key: "verb.future",
            text: `${pair}: zullen + infinitive = future ("will …").`,
            topic: "future",
          };
    }
    const bare = bareInfinitive(aux, main);
    if (bare) return bare;
    if (MODALS.has(aux.lemma)) {
      return {
        key: "verb.modal-infinitive",
        text: `${pair}: modal verb + infinitive; the infinitive goes to the end.`,
        topic: "modal-verbs",
      };
    }
  }
  return null;
}

/** Ending of a finite verb: present person ending, irregular present, weak or strong past. */
function finiteForm(s: Sentence, v: Tok, notes: WordNote[]): void {
  const f = morphFeatures(v.morph);
  const form = lower(v.text);
  const prt = particleOf(s, v);
  const lemma = baseLemma(lower(v.lemma), prt ? lower(prt.text) : undefined);
  const head = arrow(v.text, lemma, true);
  const okLemma = /n$/.test(lemma);

  if (f["Tense"] === "Past") {
    if (lemma === "zullen") return; // «zou» is explained by its role (conditional)
    if (!okLemma) return;
    const plural = f["Number"] === "Plur";
    const weak = weakPast(form, lemma);
    if (weak) {
      const ending = weak.end === "t" ? "-te" : "-de";
      notes.push({
        key: "verb.past.weak",
        text:
          `${head}: simple past of a regular verb: stem ${weak.stem} + ${ending}${plural ? "n" : ""}` +
          ` (${weak.end === "t" ? "-te after t, k, f, s, ch, p: 't kofschip" : "-de: the stem does not end in a 't kofschip sound"}).`,
        topic: "imperfect-tense",
      });
    } else if (form !== lemma) {
      notes.push({
        key: "verb.past.strong",
        text: `${head}: simple past of an irregular (strong) verb${plural ? ", plural" : ""}: no -te/-de; learn it with the verb.`,
        topic: "irregular-verbs",
      });
    }
    return;
  }
  if (f["Tense"] !== "Pres") return;

  if (MODALS.has(lemma)) {
    notes.push({
      key: "verb.modal",
      text: `${head}: present of the modal verb ${lemma} (${MODAL_FORMS[lemma]}).`,
      topic: "modal-verbs",
    });
    return;
  }
  if (lemma in IRREGULAR_PRESENT && (lemma === "zijn" || lemma === "hebben")) {
    notes.push({
      key: "verb.present.irregular",
      text: `${head}: irregular present (${IRREGULAR_PRESENT[lemma]}).`,
      topic: "present-tense",
    });
    return;
  }
  if (f["Number"] === "Plur") {
    if (form.endsWith("n") && (!okLemma || form === lemma || form.endsWith("en"))) {
      notes.push({
        key: "verb.present.plural",
        text: `${v.text}: present, plural (wij, jullie, zij): the same as the infinitive.`,
        topic: "present-tense",
      });
    }
    return;
  }
  const subj = subjectOf(s, v);
  const stem = okLemma ? verbStem(lemma) : null;
  const stemEndsT = stem ? /t$/.test(stem) : false;
  const short = lemma in IRREGULAR_PRESENT; // ga, sta, doe, zie, kom: short stems
  if (!subj) {
    const words = s.words();
    if (words[0]?.i === v.i && s.endMark() !== "?" && !form.endsWith("t")) {
      notes.push({
        key: "verb.imperative",
        text: `${head}: command form (imperative): just the stem, no subject.`,
        topic: "imperative",
      });
    }
    return;
  }
  const sl = lower(subj.text);
  if (sl === "ik") {
    if (form.endsWith("t") && !stemEndsT) return;
    notes.push({
      key: "verb.present.ik",
      text: `${head}: present with ik: just the stem, no ending${stemEndsT ? " (the stem itself ends in t)" : ""}.`,
      topic: "present-tense",
    });
    return;
  }
  if ((sl === "jij" || sl === "je") && subj.i > v.i) {
    if (form.endsWith("t") && !stemEndsT) return;
    notes.push({
      key: "verb.present.inverted-jij",
      text: `${head}: no -t, because ${sl} comes after the verb (${v.text} ${sl}?).`,
      topic: "present-tense",
    });
    return;
  }
  const sing = morphFeatures(subj.morph)["Number"] !== "Plur";
  if (!form.endsWith("t") || !sing) return;
  const who = subj.pos === "PRON" ? sl : `a singular subject (${subj.text})`;
  if (form.endsWith("dt")) {
    notes.push({
      key: "verb.present.dt",
      text: `${head}: stem ${form.slice(0, -1)} + -t after ${who}; the stem ends in d, so it is written -dt.`,
      topic: "present-tense",
    });
  } else if (stemEndsT && stem && normStem(form) === normStem(stem)) {
    notes.push({
      key: "verb.present.t",
      text: `${head}: present after ${who}; the stem already ends in t, so no extra -t.`,
      topic: "present-tense",
    });
  } else if (short || (stem && normStem(form.slice(0, -1)) === normStem(stem))) {
    notes.push({
      key: "verb.present.t",
      text: `${head}: stem + -t after ${who}.`,
      topic: "present-tense",
    });
  }
}

/** Word order of the clause of a finite verb. */
function wordOrder(s: Sentence, v: Tok): WordNote | null {
  const clause = ["aux", "aux:pass", "cop"].includes(v.dep) ? (s.head(v) ?? v) : v;
  const mark = s
    .children(clause, "mark")
    .find((m) => m.pos === "SCONJ" && m.i < v.i && lower(m.text) !== "dan");
  if (mark) {
    return {
      key: "order.subordinate",
      text: `Verb at the end: «${lower(mark.text)}» starts a subordinate clause, so ${v.text} goes last.`,
      topic: "subordinate-clauses",
    };
  }
  if (clause.dep === "acl:relcl") {
    return {
      key: "order.relative",
      text: `Verb at the end: this is a relative clause (it describes «${s.head(clause)?.text ?? "a noun"}»).`,
      topic: "relative-pronouns",
    };
  }
  if (clause.head !== clause.i) return null; // conj, ccomp, …: say less
  const words = s.words();
  const first = words[0];
  if (!first) return null;
  const subj = subjectOf(s, v);
  const question = s.endMark() === "?";
  if (question && first.i === v.i) {
    return {
      key: "order.question-yn",
      text: "Yes/no question: the verb comes first, then the subject.",
      topic: "questions",
    };
  }
  if (question && QUESTION_WORDS.has(lower(first.text))) {
    return {
      key: "order.question-wh",
      text:
        subj && subj.i === first.i
          ? `Question: the question word «${lower(first.text)}» is the subject; the verb follows it.`
          : `Question: question word «${lower(first.text)}» first, then the verb, then the subject.`,
      topic: "questions",
    };
  }
  if (question) return null;
  if (first.i === v.i) {
    return subj
      ? null
      : {
          key: "order.imperative",
          text: "Command: the verb comes first and there is no subject.",
          topic: "imperative",
        };
  }
  if (!subj) return null;
  const before = words.filter((w) => w.i < v.i);
  if (subj.i < v.i) {
    if (before.every((w) => s.under(w, subj))) {
      return {
        key: "order.v2",
        text: `Main clause: subject (${phrase(before)}) first, then the verb in second place.`,
        topic: "word-order-v2",
      };
    }
    return null;
  }
  // Subject after the verb, something else in front: inversion.
  const frontClause = before.some((w) => ["advcl", "ccomp"].includes(w.dep) && w.head === clause.i);
  return {
    key: "order.inversion",
    text: frontClause
      ? `Inversion: a whole clause (${phrase(before)}) comes first, so the verb comes before the subject (${subj.text}).`
      : `Inversion: «${phrase(before)}» comes first, so the verb stays second and the subject (${subj.text}) follows it.`,
    topic: "inversion",
  };
}

/** Up to four words of a phrase ("Omdat het regent"), shortened with "…". */
function phrase(words: readonly Tok[]): string {
  const t = words.map((w) => w.text);
  return t.length > 4 ? `${t.slice(0, 3).join(" ")} …` : t.join(" ");
}

function explainVerb(s: Sentence, v: Tok, notes: WordNote[]): void {
  const f = morphFeatures(v.morph);
  const form = f["VerbForm"];
  if (form === "Fin") {
    finiteForm(s, v, notes);
    const prt = particleOf(s, v);
    if (prt) {
      const p = lower(prt.text);
      notes.push({
        key: "verb.separable",
        text: `${v.text} … ${prt.text} = ${separableWhole(p, lower(v.lemma))}: separable verb; the particle goes to the end of the main clause.`,
        topic: "separable-verbs",
      });
    }
    const main = ["aux", "aux:pass"].includes(v.dep) ? s.head(v) : undefined;
    const role = main ? auxRole(v, main) : null;
    if (role) notes.push(role);
    const inf = prt ? undefined : bareXcomp(s, v);
    const bare = inf ? bareInfinitive(v, inf) : null;
    if (bare) notes.push(bare);
    const prog = role || bare ? null : progressive(s, v);
    if (prog) notes.push(prog);
    return;
  }
  if (form === "Part") {
    const lemma = lower(v.lemma);
    const p = participle(lower(v.text), lemma);
    const head = arrow(v.text, lemma, true);
    if (p?.kind === "weak") {
      const parts = [p.particle, p.ge ? "ge" : null, p.stem, p.end || null]
        .filter(Boolean)
        .join(" + ");
      const why =
        p.end === "t"
          ? "-t after t, k, f, s, ch, p: 't kofschip"
          : p.end === "d"
            ? "-d: the stem does not end in a 't kofschip sound"
            : "the stem already ends in t or d, so nothing is added";
      notes.push({
        key: "verb.participle.weak",
        text: `${head}: past participle of a regular verb, ${parts} (${why}).`,
        topic: "participles",
      });
    } else if (p?.kind === "strong") {
      notes.push({
        key: "verb.participle.strong",
        text: `${head}: past participle of an irregular (strong) verb, ${p.ge ? "ge- … " : ""}-en; learn it with the verb.`,
        topic: "irregular-verbs",
      });
    } else if (p?.kind === "irregular") {
      notes.push({
        key: "verb.participle.irregular",
        text: `${head}: irregular past participle; learn it with the verb.`,
        topic: "irregular-verbs",
      });
    } else if (/n$/.test(lemma)) {
      notes.push({
        key: "verb.participle",
        text: `${head}: past participle.`,
        topic: "participles",
      });
    }
    if (p && !p.ge) {
      notes.push({
        key: "verb.participle.no-ge",
        text: `No ge-: verbs that start with be-, ver-, ont-, her- or ge- never add it.`,
        topic: "participles",
      });
    }
    if (p?.particle) {
      notes.push({
        key: "verb.participle.separable",
        text: `${p.particle} + ge + …: in a separable verb, ge- goes after the particle.`,
        topic: "separable-verbs",
      });
    }
    const aux = s
      .children(v, "aux", "aux:pass")
      .find((a) => morphFeatures(a.morph)["VerbForm"] === "Fin");
    if (aux) {
      const role = auxRole(aux, v);
      if (role) notes.push(role);
    }
    return;
  }
  if (form === "Inf") {
    const marks = s.children(v, "mark").map((m) => lower(m.text));
    if (marks.includes("te")) {
      notes.push(
        marks.includes("om")
          ? {
              key: "verb.om-te",
              text: `om … te ${v.text}: "(in order) to …": om te + infinitive at the end.`,
              topic: "om-te-infinitive",
            }
          : {
              key: "verb.te",
              text: `te ${v.text}: te + infinitive after a verb like proberen, beginnen, vergeten.`,
              topic: "te-infinitive",
            },
      );
    }
    const aux = s.children(v, "aux").find((a) => morphFeatures(a.morph)["VerbForm"] === "Fin");
    const role = aux ? auxRole(aux, v) : null;
    if (role) notes.push(role);
    const h = bareXcompHead(s, v);
    if (!role && h && !particleOf(s, h)) {
      const bare = bareInfinitive(h, v);
      if (bare) notes.push(bare);
    }
    const prog = role ? null : progressive(s, v);
    if (prog) notes.push(prog);
  }
}

function explainNoun(n: Tok, notes: WordNote[], article: string | undefined): void {
  const f = morphFeatures(n.morph);
  const form = lower(n.text);
  const lemma = lower(n.lemma);
  const plural = f["Number"] === "Plur";
  const dim = /je$/.test(form) || (plural && /jes$/.test(form));
  if (dim && (lemma !== form || /je$/.test(lemma)) && (plural || f["Gender"] !== "Com")) {
    const suffix = /(etje|tje|pje|je)s?$/.exec(
      form.startsWith(lemma) ? form.slice(lemma.length) : form,
    )?.[0];
    const shown =
      suffix && form.startsWith(lemma) && lemma !== form
        ? `${lemma} + -${suffix}`
        : `-${suffix ?? "je"}`;
    notes.push({
      key: "noun.diminutive",
      text: plural
        ? `${arrow(n.text, lemma)}: plural of a diminutive (-jes); "small" or familiar.`
        : `${arrow(n.text, lemma)}: diminutive (${shown}): "small" or familiar; diminutives are always het-words.`,
      topic: "diminutives",
    });
    return;
  }
  if (plural) {
    if (form === lemma) return;
    if (form === `${lemma}s` || form === `${lemma}'s`) {
      notes.push({
        key: "noun.plural.s",
        text: `${n.text} → ${lemma}: plural with -${form.endsWith("'s") ? "'s (apostrophe after a long vowel: auto's)" : "s"}; plurals always take de.`,
        topic: "plural-nouns",
      });
    } else if (form.endsWith("eren") && form.startsWith(lemma)) {
      notes.push({
        key: "noun.plural.irregular",
        text: `${n.text} → ${lemma}: irregular plural with -eren (kind → kinderen, ei → eieren).`,
        topic: "plural-nouns",
      });
    } else if (form.endsWith("en")) {
      notes.push({
        key: "noun.plural.en",
        text: `${n.text} → ${lemma}: plural with -en; plurals always take de.`,
        topic: "plural-nouns",
      });
    } else {
      notes.push({
        key: "noun.plural",
        text: `${n.text} → ${lemma}: plural.`,
        topic: "plural-nouns",
      });
    }
    return;
  }
  if (n.pos !== "NOUN") return;
  const g =
    article === "de" || article === "het"
      ? article
      : f["Gender"] === "Com"
        ? "de"
        : f["Gender"] === "Neut"
          ? "het"
          : null;
  if (g) {
    notes.push({
      key: g === "de" ? "noun.gender.de" : "noun.gender.het",
      text:
        g === "de"
          ? `${lemma}: a de-word (de ${lemma}); adjectives before it take -e.`
          : `${lemma}: a het-word (het ${lemma}); with een, geen or no article an adjective before it has no -e.`,
      topic: "de-het",
    });
  }
}

function explainAdjective(s: Sentence, a: Tok, notes: WordNote[]): void {
  const f = morphFeatures(a.morph);
  const form = lower(a.text);
  const lemma = lower(a.lemma);
  const head = s.head(a);
  const beforeNoun =
    a.dep === "amod" &&
    head !== undefined &&
    (head.pos === "NOUN" || head.pos === "PROPN") &&
    head.i > a.i;
  if (f["Degree"] === "Cmp") {
    const dan = s.tokens.some((t) => t.i > a.i && lower(t.text) === "dan");
    notes.push({
      key: "adj.comparative",
      text: `${arrow(a.text, lemma)}: comparative (-${form.endsWith("der") && /r$/.test(lemma) ? "der after r" : "er"}): "more …"${dan ? ", with dan = than" : ""}.`,
      topic: "comparison",
    });
    return;
  }
  if (f["Degree"] === "Sup") {
    notes.push({
      key: "adj.superlative",
      text: `${arrow(a.text, lemma)}: superlative (-st${form.endsWith("e") ? " + -e before the noun" : ""}): "the most …".`,
      topic: "comparison",
    });
    return;
  }
  if (beforeNoun && head) {
    const hf = morphFeatures(head.morph);
    const det = s.children(head, "det")[0];
    const detText = det ? lower(det.text) : null;
    const poss = s.children(head, "nmod:poss")[0];
    const pluralNoun = hf["Number"] === "Plur";
    const inflected = form.endsWith("e") && !lemma.endsWith("e") && form !== lemma;
    if (inflected) {
      if ((detText && DEFINITE.has(detText)) || poss) {
        const w = poss ? lower(poss.text) : (detText as string);
        notes.push({
          key: "adj.e.definite",
          text: `${arrow(a.text, lemma)}: -e ending after «${w}»: after de, het, deze, die, dit, dat or a possessive the adjective always takes -e.`,
          topic: "adjective-inflection",
        });
      } else if (pluralNoun) {
        notes.push({
          key: "adj.e.plural",
          text: `${arrow(a.text, lemma)}: -e ending before a plural noun (${head.text}).`,
          topic: "adjective-inflection",
        });
      } else if (hf["Gender"] === "Com") {
        notes.push({
          key: "adj.e.de-word",
          text: `${arrow(a.text, lemma)}: -e ending because ${head.text} is a de-word${detText ? ` (even after ${detText})` : ""}.`,
          topic: "adjective-inflection",
        });
      } else {
        notes.push({
          key: "adj.e",
          text: `${arrow(a.text, lemma)}: -e ending before the noun.`,
          topic: "adjective-inflection",
        });
      }
    } else if (form === lemma && !lemma.endsWith("e")) {
      if (/en$/.test(lemma)) {
        notes.push({
          key: "adj.no-e.en",
          text: `${a.text}: adjectives ending in -en (gouden, open) never take -e.`,
          topic: "adjective-inflection",
        });
      } else if (
        !pluralNoun &&
        hf["Gender"] === "Neut" &&
        !poss &&
        (detText === null || NO_E_DETS.has(detText))
      ) {
        notes.push({
          key: "adj.no-e.het",
          text: `${a.text}: no -e, because ${head.text} is a het-word with ${detText ?? "no article"} (${detText ?? ""}${detText ? " " : ""}${a.text} ${head.text}).`,
          topic: "adjective-inflection",
        });
      }
    }
    return;
  }
  if (form !== lemma || lemma.endsWith("e")) return;
  const cop = s.children(a, "cop").length > 0;
  if (cop || a.dep === "xcomp") {
    notes.push({
      key: "adj.predicative",
      text: `${a.text}: no ending after the verb (it describes the subject or object, not a noun right after it).`,
      topic: "adjective-inflection",
    });
  } else if (a.dep === "advmod" && head && isVerb(head)) {
    notes.push({
      key: "adj.adverb",
      text: `${a.text}: used as an adverb (says how); adverbs never take an ending.`,
      topic: "adverbs",
    });
  }
}

function explainPronoun(s: Sentence, p: Tok, notes: WordNote[], hits: readonly GrammarHit[]): void {
  const f = morphFeatures(p.morph);
  const w = lower(p.text);
  if (f["Poss"] === "Yes") {
    const en = POSSESSIVE_EN[w];
    if (!en) return;
    notes.push({
      key: "pron.possessive",
      text:
        w === "ons" || w === "onze"
          ? `${p.text}: possessive "our": ons before a singular het-word, onze before de-words and plurals.`
          : `${p.text}: possessive "${en}".`,
      topic: "possessive-pronouns",
    });
    return;
  }
  if (f["Reflex"] === "Yes" || p.dep === "expl:pv") {
    notes.push({
      key: "pron.reflexive",
      text: `${p.text}: reflexive pronoun: it refers back to the subject (zich wassen = to wash oneself).`,
      topic: "reflexive-verbs",
    });
    return;
  }
  if (f["PronType"] === "Rel") {
    notes.push({
      key: "pron.relative",
      text: `${p.text}: relative pronoun: die after de-words and plurals, dat after het-words; the verb goes to the end.`,
      topic: "relative-pronouns",
    });
    return;
  }
  if (w === "er") {
    const split = splitPronominal(s, p, hits);
    if (split) notes.push(split);
    return;
  }
  if (f["PronType"] === "Dem" && ["dit", "dat", "deze", "die"].includes(w)) {
    notes.push(demonstrative(p));
    return;
  }
  if (f["PronType"] === "Int" && QUESTION_WORDS.has(w)) {
    notes.push({ key: "pron.question", text: `${p.text}: question word.`, topic: "questions" });
    return;
  }
  if (f["PronType"] !== "Prs") return;
  const subject = f["Case"] === "Nom" || p.dep === "nsubj" || p.dep === "nsubj:pass";
  if (subject && SUBJECT_EN[w]) {
    const weak = UNSTRESSED[w];
    notes.push({
      key: "pron.subject",
      text: `${p.text}: subject pronoun "${SUBJECT_EN[w]}"${weak ? `; the unstressed form of ${weak}` : ""}.`,
      topic: "personal-pronouns",
    });
    return;
  }
  const object = f["Case"] === "Acc" || ["obj", "iobj", "obl", "obl:agent"].includes(p.dep);
  const o = OBJECT_EN[w];
  if (object && o && !(w === "het" && f["Case"] !== "Acc" && !["obj", "iobj"].includes(p.dep))) {
    const prep = s.children(p, "case").find((c) => c.pos === "ADP");
    notes.push({
      key: "pron.object",
      text:
        o[0] === w
          ? `${p.text}: object pronoun "${o[1]}"${prep ? ` after the preposition ${prep.text}` : ""}.`
          : `${p.text}: object form of ${o[0]} ("${o[1]}")${prep ? ` after the preposition ${prep.text}` : ""}.`,
      topic: "object-pronouns",
    });
  }
}

function demonstrative(t: Tok): WordNote {
  const w = lower(t.text);
  const near = w === "dit" || w === "deze";
  return {
    key: "pron.demonstrative",
    text: `${t.text}: demonstrative "${near ? "this" : "that"}"; ${near ? "deze" : "die"} with de-words and plurals, ${near ? "dit" : "dat"} with het-words.`,
    topic: "demonstratives",
  };
}

/** «er … over»: a pronominal adverb split in two, from the detector's hit. */
function splitPronominal(s: Sentence, t: Tok, hits: readonly GrammarHit[]): WordNote | null {
  const hit = hits.find((h) => h.topic === "pronominal-adverbs" && h.tokens.includes(t.i));
  if (!hit) return null;
  const parts = hit.tokens.map((i) => s.get(i)).filter((x): x is Tok => x !== undefined);
  const first = parts.find((x) => /^(er|daar|hier|waar)$/i.test(x.text));
  const prep = parts.find((x) => x !== first && x.pos === "ADP");
  if (!first || !prep) return null;
  const a = lower(first.text);
  const b = lower(prep.text);
  const joined = `${a}${b === "met" ? "mee" : b === "tot" ? "toe" : b}`;
  return {
    key: "adv.pronominal",
    text: `${first.text} … ${prep.text} = ${joined} (${b} + ${PRONOMINAL_EN[a] ?? "it"}): the two parts can stand apart.`,
    topic: "pronominal-adverbs",
  };
}

/** Notes about the form of token `index` and, for a finite verb, the order of its clause. */
export function explainWord(
  tokens: readonly AnalyzedToken[],
  index: number,
  opts: ExplainOptions = {},
): WordGrammar {
  const sent = new Sentence(sentenceAround(tokens, index));
  const t = sent.get(index);
  const notes: WordNote[] = [];
  if (!t || !/\p{L}/u.test(t.text)) return { notes, order: null };
  const hits = opts.hits ?? [];
  const w = lower(t.text);
  const f = morphFeatures(t.morph);
  let order: WordNote | null = null;
  // «aan het» before an infinitive with zijn: the progressive, not a preposition or article.
  const prog = w === "aan" || w === "het" ? progressive(sent, t) : null;

  if (prog) {
    notes.push(prog);
  } else if (t.particle_of !== null || t.dep === "compound:prt") {
    const v = sent.get(t.particle_of ?? t.head);
    if (v && isVerb(v)) {
      notes.push({
        key: "verb.particle",
        text: `${t.text}: particle of the separable verb ${separableWhole(w, lower(v.lemma))} (${v.text} … ${t.text}); it goes to the end of the main clause.`,
        topic: "separable-verbs",
      });
    }
  } else if (isVerb(t)) {
    explainVerb(sent, t, notes);
    if (f["VerbForm"] === "Fin") order = wordOrder(sent, t);
  } else if (t.pos === "NOUN" || t.pos === "PROPN") {
    explainNoun(t, notes, opts.article);
  } else if (t.pos === "ADJ") {
    explainAdjective(sent, t, notes);
  } else if (t.pos === "PRON") {
    explainPronoun(sent, t, notes, hits);
  } else if (t.pos === "DET") {
    if (f["PronType"] === "Dem" && ["dit", "dat", "deze", "die"].includes(w)) {
      notes.push(demonstrative(t));
    } else if (w === "de" || w === "het") {
      notes.push({
        key: "det.article",
        text:
          w === "de"
            ? "de: article for de-words and for every plural."
            : "het: article for het-words (singular only; plurals take de).",
        topic: "de-het",
      });
    } else if (w === "een") {
      notes.push({
        key: "det.article",
        text: 'een: "a / an", the same for de- and het-words.',
        topic: "de-het",
      });
    } else if (w === "geen") {
      notes.push({
        key: "det.geen",
        text: 'geen: "no / not a": negates a noun that would have een or no article.',
        topic: "negation",
      });
    }
  } else if (t.pos === "ADV") {
    const m = PRONOMINAL.exec(w);
    if (m) {
      const [, a = "", b = ""] = m;
      notes.push({
        key: "adv.pronominal",
        text: `${t.text} = ${a} + ${PREP_FOR[b] ?? b} ("${PREP_FOR[b] ?? b} ${PRONOMINAL_EN[a] ?? "it"}"): Dutch uses this instead of a preposition + het/dat.`,
        topic: "pronominal-adverbs",
      });
    } else if (/^(daar|hier|waar)$/.test(w)) {
      const split = splitPronominal(sent, t, hits);
      if (split) notes.push(split);
      else if (w === "waar" && sent.endMark() === "?" && sent.words()[0]?.i === t.i) {
        notes.push({
          key: "pron.question",
          text: `${t.text}: question word ("where").`,
          topic: "questions",
        });
      }
    }
  } else if (t.pos === "ADP") {
    const h = sent.head(t);
    if (w === "te" && t.dep === "mark" && h) {
      const om = sent.children(h, "mark").some((m) => lower(m.text) === "om");
      notes.push(
        om
          ? {
              key: "om.marker",
              text: `te: part of om … te ${h.text} ("in order to").`,
              topic: "om-te-infinitive",
            }
          : {
              key: "te.marker",
              text: `te: marks the infinitive (te ${h.text}).`,
              topic: "te-infinitive",
            },
      );
    } else if (w === "om" && t.dep === "mark" && h) {
      notes.push({
        key: "om.marker",
        text: `om: starts om … te ${h.text} ("in order to").`,
        topic: "om-te-infinitive",
      });
    } else {
      const split = splitPronominal(sent, t, hits);
      if (split) notes.push(split);
    }
  } else if (t.pos === "SCONJ" && t.dep === "mark") {
    const h = sent.head(t);
    if (h && isVerb(h) && w !== "dan") {
      notes.push({
        key: "conj.subordinating",
        text: `${t.text}: starts a subordinate clause; its verb (${h.text}) goes to the end.`,
        topic: "subordinate-clauses",
      });
    }
  } else if (t.pos === "CCONJ" && ["en", "maar", "want", "of"].includes(w)) {
    notes.push({
      key: "conj.coordinating",
      text: `${t.text}: joins two words or main clauses; the word order after it does not change.`,
      topic: "conjunctions",
    });
  }

  if (notes.length === 0) {
    const lemma = lower(t.lemma) || w;
    const name = POS_NAME[t.pos];
    if (name) {
      notes.push({
        key: "plain",
        text: `${lemma}: ${name}${UNCHANGING.has(t.pos) ? "; words like this do not change form" : ""}.`,
      });
    }
  }
  return { notes, order };
}
