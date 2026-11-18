import { describe, expect, it } from "vitest";
import { WORD_NOTE_TOPICS, explainWord, morphFeatures } from "./explain.js";
import type { GrammarHit } from "./grammar.js";
import type { AnalyzedToken } from "./types.js";
import fixtures from "./fixtures/word-grammar.nl.json";

/**
 * Fixture analyses captured from the real NLP server (spaCy nl_core_news, kenning_nlp
 * analyze_texts + detect_grammar), one sentence each, stored compactly as
 * [text, lemma, pos, morph, dep, head, particle_of] per token and [topic, tokens] per hit.
 */
type Row = [string, string, string, string, string, number, number | null];
interface Fixture {
  text: string;
  tokens: Row[];
  hits: [string, number[]][];
}

function load(text: string): { tokens: AnalyzedToken[]; hits: GrammarHit[] } {
  const fx = (fixtures as Fixture[]).find((f) => f.text === text);
  if (!fx) throw new Error(`no fixture for: ${text}`);
  const tokens = fx.tokens.map(
    ([t, lemma, pos, morph, dep, head, particle_of], i): AnalyzedToken => ({
      i,
      text: t,
      lemma,
      alt_lemmas: [],
      pos,
      morph,
      dep,
      head,
      sent: 0,
      start: 0,
      end: 0,
      is_word: pos !== "PUNCT",
      is_propn: pos === "PROPN",
      is_num: pos === "NUM",
      particle_of,
      zipf: 5,
    }),
  );
  const hits = fx.hits.map(([topic, toks]) => ({
    topic,
    tokens: toks,
    sent: 0,
    start: 0,
    end: 0,
    note: "",
  }));
  return { tokens, hits };
}

function explain(text: string, word: string) {
  const { tokens, hits } = load(text);
  const t = tokens.find((x) => x.text === word);
  if (!t) throw new Error(`no token ${word} in ${text}`);
  return explainWord(tokens, t.i, { hits });
}

// [sentence, word, note keys (in order), word-order key or null]
const TABLE: [string, string, string[], string | null][] = [
  // verbs: past
  ["Hij liep gisteren naar huis.", "liep", ["verb.past.strong"], "order.v2"],
  ["Ik werkte de hele dag.", "werkte", ["verb.past.weak"], "order.v2"],
  ["Zij werkten samen in Rotterdam.", "werkten", ["verb.past.weak"], "order.v2"],
  ["Hij dacht aan zijn vriendin.", "dacht", ["verb.past.strong"], "order.v2"],
  ["Gisteren ging ik naar de markt.", "ging", ["verb.past.strong"], "order.inversion"],
  // verbs: present
  ["Jij werkt hard.", "werkt", ["verb.present.t"], "order.v2"],
  ["Werk jij morgen?", "Werk", ["verb.present.inverted-jij"], "order.question-yn"],
  ["Waar woon je?", "woon", ["verb.present.inverted-jij"], "order.question-wh"],
  ["Zit jij hier vaak?", "Zit", ["verb.present.inverted-jij"], "order.question-yn"],
  ["Vindt hij het leuk?", "Vindt", ["verb.present.dt"], "order.question-yn"],
  ["Ik werk thuis.", "werk", ["verb.present.ik", "verb.separable"], "order.v2"],
  ["De oude man zit op een bank.", "zit", ["verb.present.t"], "order.v2"],
  ["De boeken liggen op tafel.", "liggen", ["verb.present.plural"], "order.v2"],
  ["Ik ben moe.", "ben", ["verb.present.irregular"], "order.v2"],
  ["Ik kan niet zwemmen.", "kan", ["verb.modal", "verb.modal-infinitive"], "order.v2"],
  ["Kom binnen!", "Kom", ["verb.imperative", "verb.separable"], "order.imperative"],
  // separable verbs
  ["Ik bel je morgen op.", "bel", ["verb.present.ik", "verb.separable"], "order.v2"],
  ["Ik bel je morgen op.", "op", ["verb.particle"], null],
  ["Ik denk erover na.", "na", ["verb.particle"], null],
  // participles, perfect, passive
  ["Ik heb mijn moeder gebeld.", "gebeld", ["verb.participle.weak", "verb.perfect"], null],
  ["We hebben lang gewerkt.", "gewerkt", ["verb.participle.weak", "verb.perfect"], null],
  [
    "Ik heb hem opgebeld.",
    "opgebeld",
    ["verb.participle.weak", "verb.participle.separable", "verb.perfect"],
    null,
  ],
  ["Ik heb hem opgebeld.", "heb", ["verb.present.irregular", "verb.perfect"], "order.v2"],
  ["Ze zijn naar huis gegaan.", "gegaan", ["verb.participle.strong", "verb.perfect"], null],
  [
    "Ik heb het niet begrepen.",
    "begrepen",
    ["verb.participle.strong", "verb.participle.no-ge", "verb.perfect"],
    null,
  ],
  [
    "Het huis wordt verkocht.",
    "verkocht",
    ["verb.participle.irregular", "verb.participle.no-ge", "verb.passive"],
    null,
  ],
  ["Het huis wordt verkocht.", "wordt", ["verb.present.dt", "verb.passive"], "order.v2"],
  [
    "De brief werd door haar geschreven.",
    "geschreven",
    ["verb.participle.strong", "verb.passive"],
    null,
  ],
  // infinitives
  ["Ze probeert Nederlands te leren.", "leren", ["verb.te"], null],
  ["Hij gaat naar Amsterdam om zijn zus te bezoeken.", "bezoeken", ["verb.om-te"], null],
  ["Ik kan niet zwemmen.", "zwemmen", ["verb.modal-infinitive"], null],
  ["Hij zou het boek kopen als hij geld had.", "kopen", ["verb.conditional"], null],
  ["Hij zou het boek kopen als hij geld had.", "zou", ["verb.conditional"], "order.v2"],
  ["Hij zal morgen komen.", "komen", ["verb.future"], null],
  // gaan / laten + infinitive, aan het + infinitive (B9)
  [
    "Ik ga morgen boodschappen doen.",
    "ga",
    ["verb.present.ik", "verb.gaan-infinitive"],
    "order.v2",
  ],
  ["Ik ga morgen boodschappen doen.", "doen", ["verb.gaan-infinitive"], null],
  ["We gaan vanavond film kijken.", "kijken", ["verb.gaan-infinitive"], null],
  ["Ik ga naar huis.", "ga", ["verb.present.ik"], "order.v2"],
  [
    "Ik laat mijn fiets repareren.",
    "laat",
    ["verb.present.ik", "verb.laten-infinitive"],
    "order.v2",
  ],
  ["Ik laat mijn fiets repareren.", "repareren", ["verb.laten-infinitive"], null],
  ["Ze laten hun kinderen buiten spelen.", "spelen", ["verb.laten-infinitive"], null],
  ["Zij liet de hond uit.", "liet", ["verb.past.strong", "verb.separable"], "order.v2"],
  ["Ik ben aan het koken.", "koken", ["verb.progressive"], null],
  ["Ik ben aan het koken.", "ben", ["verb.present.irregular", "verb.progressive"], "order.v2"],
  ["Ik ben aan het koken.", "het", ["verb.progressive"], null],
  ["Hij was een boek aan het lezen.", "lezen", ["verb.progressive"], null],
  ["Hij was een boek aan het lezen.", "aan", ["verb.progressive"], null],
  // perfect: hebben or zijn
  ["Ik ben naar huis gefietst.", "gefietst", ["verb.participle.weak", "verb.perfect"], null],
  ["Ik heb twee uur gefietst.", "gefietst", ["verb.participle.weak", "verb.perfect"], null],
  [
    "Hij is gisteren vertrokken.",
    "vertrokken",
    ["verb.participle.strong", "verb.participle.no-ge", "verb.perfect"],
    null,
  ],
  ["Ze is ziek geworden.", "is", ["verb.present.irregular", "verb.perfect"], "order.v2"],
  // word order in subordinate clauses
  ["Ik weet dat hij morgen komt.", "komt", ["verb.present.t"], "order.subordinate"],
  ["Hij zou het boek kopen als hij geld had.", "had", ["verb.past.strong"], "order.subordinate"],
  ["Dat is het huis waar ik woon.", "woon", ["verb.present.ik"], "order.relative"],
  [
    "Omdat het regent, blijf ik thuis.",
    "blijf",
    ["verb.present.ik", "verb.separable"],
    "order.inversion",
  ],
  ["Omdat het regent, blijf ik thuis.", "Omdat", ["conj.subordinating"], null],
  [
    "Wie heeft dat gedaan?",
    "heeft",
    ["verb.present.irregular", "verb.perfect"],
    "order.question-wh",
  ],
  // nouns
  ["De kinderen spelen buiten.", "kinderen", ["noun.plural.irregular"], null],
  ["Ik heb twee auto's.", "auto's", ["noun.plural.s"], null],
  ["De boeken liggen op tafel.", "boeken", ["noun.plural.en"], null],
  ["We drinken een kopje koffie.", "kopje", ["noun.diminutive"], null],
  ["Het tafeltje is klein.", "tafeltje", ["noun.diminutive"], null],
  ["Het boompje groeit snel.", "boompje", ["noun.diminutive"], null],
  ["Het ringetje is van goud.", "ringetje", ["noun.diminutive"], null],
  ["Hij liep gisteren naar huis.", "huis", ["noun.gender.het"], null],
  ["Ik werkte de hele dag.", "dag", ["noun.gender.de"], null],
  // adjectives
  ["Dat is een mooie stad.", "mooie", ["adj.e.de-word"], null],
  ["Het is een mooi huis.", "mooi", ["adj.no-e.het"], null],
  ["Wij hebben geen groot huis.", "groot", ["adj.no-e.het"], null],
  ["Het grote huis staat leeg.", "grote", ["adj.e.definite"], null],
  ["Ik koop verse kaas.", "verse", ["adj.e.de-word"], null],
  ["Mijn broer is groter dan ik.", "groter", ["adj.comparative"], null],
  ["Dit is het mooiste boek.", "mooiste", ["adj.superlative"], null],
  ["Het tafeltje is klein.", "klein", ["adj.predicative"], null],
  ["Jij werkt hard.", "hard", ["adj.adverb"], null],
  // pronouns and pronominal adverbs
  ["Zij woont in Utrecht.", "Zij", ["pron.subject"], null],
  ["Ik zie hem elke dag.", "hem", ["pron.object"], null],
  ["De brief werd door haar geschreven.", "haar", ["pron.object"], null],
  ["Hij wast zich elke ochtend.", "zich", ["pron.reflexive"], null],
  ["Dat is mijn fiets.", "mijn", ["pron.possessive"], null],
  ["Dit is het mooiste boek.", "Dit", ["pron.demonstrative"], null],
  ["Ik denk erover na.", "erover", ["adv.pronominal"], null],
  ["Ik heb er lang over nagedacht.", "er", ["adv.pronominal"], null],
  // te / om
  ["Ze probeert Nederlands te leren.", "te", ["te.marker"], null],
  // say less: plain lemma + part of speech
  ["Hij liep gisteren naar huis.", "gisteren", ["plain"], null],
  ["Ik ben moe.", "moe", ["plain"], null],
];

describe("explainWord (fixtures from the real NLP server)", () => {
  it.each(TABLE)("%s — %s", (text, word, keys, order) => {
    const r = explain(text, word);
    expect(r.notes.map((n) => n.key)).toEqual(keys);
    expect(r.order?.key ?? null).toBe(order);
  });

  it("links every note but the plain line to a topic", () => {
    for (const [text, word] of TABLE) {
      for (const n of explain(text, word).notes) {
        if (n.key === "plain") expect(n.topic).toBeUndefined();
        else expect(WORD_NOTE_TOPICS, `${word}: ${n.key}`).toContain(n.topic);
      }
    }
  });

  it("writes the forms it explains", () => {
    expect(explain("Hij liep gisteren naar huis.", "liep").notes[0]?.text).toMatch(
      /^liep → lopen: simple past of an irregular/,
    );
    expect(explain("Ik heb mijn moeder gebeld.", "gebeld").notes[0]?.text).toMatch(
      /ge \+ bel \+ d .*'t kofschip/,
    );
    expect(explain("We hebben lang gewerkt.", "gewerkt").notes[0]?.text).toMatch(/ge \+ werk \+ t/);
    expect(explain("Ik bel je morgen op.", "bel").notes[1]?.text).toMatch(/^bel … op = opbellen/);
    expect(explain("Gisteren ging ik naar de markt.", "ging").order?.text).toMatch(/«Gisteren»/);
    expect(explain("Het is een mooi huis.", "mooi").notes[0]?.text).toMatch(/een mooi huis/);
  });

  it("says why a perfect takes hebben or zijn", () => {
    const note = (text: string, word: string) =>
      explain(text, word).notes.find((n) => n.key === "verb.perfect");
    expect(note("Ik ben naar huis gefietst.", "gefietst")?.text).toMatch(/where to/);
    expect(note("Ik ben naar huis gefietst.", "gefietst")?.topic).toBe("hebben-or-zijn");
    expect(note("Ik heb twee uur gefietst.", "gefietst")?.text).toMatch(/just the activity/);
    expect(note("Hij is gisteren vertrokken.", "vertrokken")?.text).toMatch(
      /change of place or state/,
    );
    expect(note("Ik heb mijn moeder gebeld.", "gebeld")?.text).toMatch(/most verbs take hebben/);
    expect(explain("Ik ga morgen boodschappen doen.", "doen").notes[0]?.text).toMatch(
      /^ga … doen: gaan \+ infinitive = "going to …"/,
    );
  });

  it("says less when the analysis does not support a rule", () => {
    const { tokens } = load("Jij werkt hard.");
    // A wrong subject (ik) with a -t form: just lemma + part of speech, not a wrong rule.
    const odd = tokens.map((t) => (t.text === "Jij" ? { ...t, text: "Ik", lemma: "ik" } : t));
    expect(explainWord(odd, 1).notes).toEqual([{ key: "plain", text: "werken: verb." }]);
    // A token without letters or out of range explains nothing.
    expect(explainWord(tokens, 3)).toEqual({ notes: [], order: null });
    expect(explainWord(tokens, 99)).toEqual({ notes: [], order: null });
  });

  it("prefers the dictionary article over the analyzer's gender", () => {
    const { tokens } = load("Ik werkte de hele dag.");
    expect(explainWord(tokens, 4, { article: "het" }).notes[0]?.key).toBe("noun.gender.het");
  });

  it("only looks at the clicked word's sentence", () => {
    const a = load("Ik bel je morgen op.").tokens;
    const b = load("Ik zie hem elke dag.").tokens.map((t) => ({
      ...t,
      i: t.i + a.length,
      head: t.head + a.length,
      sent: 1,
    }));
    const r = explainWord([...a, ...b], a.length + 1);
    expect(r.notes.map((n) => n.key)).toEqual(["verb.present.ik"]);
    expect(r.order?.key).toBe("order.v2");
  });

  it("parses morph strings", () => {
    expect(morphFeatures("Number=Sing|Tense=Past|VerbForm=Fin")).toEqual({
      Number: "Sing",
      Tense: "Past",
      VerbForm: "Fin",
    });
    expect(morphFeatures("")).toEqual({});
  });
});
