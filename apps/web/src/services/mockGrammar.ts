/**
 * Grammar for the mock services: hand-labelled hits on the sample texts (what the server's
 * detectors find there), a few Tatoeba-style examples per topic and topic sessions built by the
 * real engine (`buildTopicSession`).
 */
import {
  type AnalyzedToken,
  type Exercise,
  type GrammarHit,
  type TopicSentence,
  type WordData,
  buildTopicSession,
  countHits,
  createRng,
} from "@app/core";
import type { StoredText } from "@app/db";
import type {
  GrammarOverview,
  LibraryGrammarExample,
  TatoebaGrammarExample,
  TopicExamples,
  TopicPracticeOptions,
} from "./types.js";

/** [topic, words of the construction in order (first one unique in the text), note] */
type HitSpec = [string, string[], string];

const SAMPLE_HITS: Record<string, HitSpec[]> = {
  "t-utrecht": [
    ["separable-verbs", ["bel", "op"], "«bel … op» is «opbellen»: the particle goes to the end."],
    ["adjective-inflection", ["mooie", "stad"], "«mooie» before «stad»: -e with a de-word."],
    ["plural-nouns", ["grachten"], "«grachten» is the plural of «gracht» (-en)."],
    [
      "inversion",
      ["staat", "zij"],
      "«Vandaag» comes first, so the verb «staat» goes before the subject «zij».",
    ],
    [
      "separable-verbs",
      ["staat", "op"],
      "«staat … op» is «opstaan»: the particle goes to the end.",
    ],
    [
      "subordinate-clauses",
      ["omdat", "vertrekt"],
      "«omdat» starts a subordinate clause: the verb «vertrekt» goes to the end.",
    ],
    [
      "separable-verbs",
      ["neemt", "mee"],
      "«neemt … mee» is «meenemen»: the particle goes to the end.",
    ],
    ["conjunctions", ["want"], "«want» joins two main clauses; the word order stays the same."],
  ],
  "t-markt": [
    ["adjective-inflection", ["verse", "kaas"], "«verse» before «kaas»: -e with a de-word."],
    ["plural-nouns", ["kinderen"], "«kinderen» is the plural of «kind» (irregular)."],
    [
      "adjective-inflection",
      ["grote", "hond"],
      "«grote» before «hond»: -e after «een» with a de-word.",
    ],
    [
      "subordinate-clauses",
      ["als", "langskomt"],
      "«als» starts a subordinate clause: the verb «langskomt» goes to the end.",
    ],
  ],
  "t-weer": [
    ["plural-nouns", ["dagen"], "«dagen» is the plural of «dag» (-en)."],
    ["conjunctions", ["en"], "«en» joins two main clauses; the word order stays the same."],
    [
      "inversion",
      ["wordt", "het"],
      "«Morgen» comes first, so the verb «wordt» goes before the subject «het».",
    ],
    ["comparison", ["beter"], "«beter» is the comparative of «goed»."],
  ],
};

/** [topic, sentence, construction words, translation, note] */
type ExampleSpec = [string, string, string[], string, string];

const TATOEBA: ExampleSpec[] = [
  [
    "inversion",
    "Morgen ga ik naar school.",
    ["ga", "ik"],
    "Tomorrow I am going to school.",
    "«Morgen» comes first, so the verb «ga» goes before the subject «ik».",
  ],
  [
    "inversion",
    "Gisteren kocht hij een nieuwe fiets.",
    ["kocht", "hij"],
    "Yesterday he bought a new bike.",
    "«Gisteren» comes first, so the verb «kocht» goes before the subject «hij».",
  ],
  [
    "subordinate-clauses",
    "Ik blijf thuis omdat het regent.",
    ["omdat", "regent"],
    "I am staying home because it is raining.",
    "«omdat» starts a subordinate clause: the verb «regent» goes to the end.",
  ],
  [
    "subordinate-clauses",
    "Ik weet niet of hij komt.",
    ["of", "komt"],
    "I do not know whether he is coming.",
    "«of» starts a subordinate clause: the verb «komt» goes to the end.",
  ],
  [
    "separable-verbs",
    "Hij belt zijn moeder elke dag op.",
    ["belt", "op"],
    "He calls his mother every day.",
    "«belt … op» is «opbellen»: the particle goes to the end.",
  ],
  [
    "negation",
    "Ik heb geen tijd vandaag.",
    ["geen"],
    "I have no time today.",
    "«geen» negates a noun without an article or with «een».",
  ],
  [
    "negation",
    "Hij komt vanavond niet.",
    ["niet"],
    "He is not coming tonight.",
    "«niet» negates the verb or the word after it.",
  ],
  [
    "diminutives",
    "Het meisje heeft een hondje.",
    ["hondje"],
    "The girl has a little dog.",
    "«hondje» is a diminutive (-je), so it is a het-word.",
  ],
  [
    "diminutives",
    "Wil je een kopje thee?",
    ["kopje"],
    "Would you like a cup of tea?",
    "«kopje» is a diminutive (-je), so it is a het-word.",
  ],
  [
    "perfect-tense",
    "Zij heeft het boek gelezen.",
    ["heeft", "gelezen"],
    "She has read the book.",
    "Perfect tense: «heeft» + the participle «gelezen» at the end.",
  ],
  [
    "plural-nouns",
    "De kinderen spelen buiten.",
    ["kinderen"],
    "The children are playing outside.",
    "«kinderen» is the plural of «kind» (irregular).",
  ],
  [
    "er",
    "Er staat een kat op het dak.",
    ["Er"],
    "There is a cat on the roof.",
    "«Er» introduces something new: «er is… / er staat…».",
  ],
];

/** Token indices of `words` in order inside one sentence, the first word's first occurrence. */
function findTokens(tokens: AnalyzedToken[], words: string[]): AnalyzedToken[] | null {
  const low = (t: AnalyzedToken) => t.text.toLowerCase();
  const first = tokens.find((t) => low(t) === words[0]);
  if (!first) return null;
  const out = [first];
  for (const w of words.slice(1)) {
    const next = tokens.find(
      (t) => t.i > (out[out.length - 1]?.i ?? 0) && t.sent === first.sent && low(t) === w,
    );
    if (!next) return null;
    out.push(next);
  }
  return out;
}

/** Character span of a sentence, from its tokens. */
function sentenceSpan(tokens: AnalyzedToken[], sent: number): [number, number] {
  const ts = tokens.filter((t) => t.sent === sent);
  return [ts[0]?.start ?? 0, ts[ts.length - 1]?.end ?? 0];
}

/** Hits of a mock text from SAMPLE_HITS (imported texts have none). */
function mockHits(text: StoredText): GrammarHit[] {
  const tokens = text.tokens ?? [];
  const hits: GrammarHit[] = [];
  for (const [topic, words, note] of SAMPLE_HITS[text.id] ?? []) {
    const found = findTokens(tokens, words);
    if (!found) continue;
    const sent = found[0]!.sent;
    const [start, end] = sentenceSpan(tokens, sent);
    hits.push({ topic, tokens: found.map((t) => t.i), sent, start, end, note });
  }
  return hits.sort((a, b) => a.start - b.start || (a.tokens[0] ?? 0) - (b.tokens[0] ?? 0));
}

function marksIn(sentence: string, words: string[]): [number, number][] {
  const out: [number, number][] = [];
  let from = 0;
  for (const w of words) {
    const at = sentence.indexOf(w, from);
    if (at < 0) continue;
    out.push([at, at + w.length]);
    from = at + w.length;
  }
  return out;
}

export function createMockGrammar(
  wait: () => Promise<void>,
  texts: () => StoredText[],
  articles: (lemma: string) => string | undefined,
) {
  const hitsOf = (t: StoredText) => mockHits(t);

  function library(detects: Set<string>): (LibraryGrammarExample & { hit: GrammarHit })[] {
    const out: (LibraryGrammarExample & { hit: GrammarHit })[] = [];
    for (const t of texts()) {
      for (const hit of hitsOf(t).filter((h) => detects.has(h.topic))) {
        const tokens = t.tokens ?? [];
        out.push({
          textId: t.id,
          title: t.title,
          topic: hit.topic,
          sentence: t.content.slice(hit.start, hit.end),
          marks: hit.tokens.map((i) => {
            const tok = tokens[i]!;
            return [tok.start - hit.start, tok.end - hit.start] as [number, number];
          }),
          note: hit.note,
          hit,
        });
      }
    }
    return out;
  }

  function tatoeba(detects: Set<string>): TatoebaGrammarExample[] {
    return TATOEBA.filter(([topic]) => detects.has(topic)).map(
      ([topic, text, words, translation, note]) => ({
        topic,
        text,
        translation,
        marks: marksIn(text, words),
        note,
      }),
    );
  }

  return {
    async textGrammar(textId: string): Promise<GrammarHit[]> {
      await wait();
      const t = texts().find((x) => x.id === textId);
      return t ? hitsOf(t) : [];
    },

    async grammarOverview(): Promise<GrammarOverview> {
      await wait();
      const counts: Record<string, number> = {};
      const textCounts: Record<string, number> = {};
      const all = texts().filter((t) => t.tokens);
      for (const t of all) {
        for (const [topic, n] of Object.entries(countHits(hitsOf(t)))) {
          counts[topic] = (counts[topic] ?? 0) + n;
          textCounts[topic] = (textCounts[topic] ?? 0) + 1;
        }
      }
      return { counts, textCounts, texts: all.length, missing: 0 };
    },

    async grammarExamples(
      detects: string[],
      opts: { limit?: number } = {},
    ): Promise<TopicExamples> {
      await wait();
      const set = new Set(detects);
      const limit = opts.limit ?? 8;
      return {
        library: library(set)
          .slice(0, limit)
          .map(({ textId, title, topic, sentence, marks, note }) => ({
            textId,
            title,
            topic,
            sentence,
            marks,
            note,
          })),
        tatoeba: tatoeba(set).slice(0, limit),
        tatoebaUnavailable: false,
      };
    },

    async startTopicPractice(opts: TopicPracticeOptions): Promise<Exercise[]> {
      await wait();
      const set = new Set(opts.detects);
      const sentences: TopicSentence[] = [
        ...library(set).map((e) => ({
          text: e.sentence,
          marks: e.marks,
          note: e.note,
          source: "text" as const,
          key: e.sentence.slice(...(e.marks[0] ?? [0, 0])).toLowerCase(),
        })),
        ...tatoeba(set).map((e) => ({
          text: e.text,
          translation: e.translation,
          marks: e.marks,
          note: e.note,
          source: "tatoeba" as const,
          key: e.text.slice(...(e.marks[0] ?? [0, 0])).toLowerCase(),
        })),
      ];
      // Nouns of the hits for gender exercises (articles from the demo lexicon or -je = het).
      const words: WordData[] = [];
      for (const s of sentences) {
        for (const [a, b] of s.marks) {
          const lemma = s.text.slice(a, b).toLowerCase();
          const article = /je$/.test(lemma) ? "het" : articles(lemma);
          if (!article || words.some((w) => w.key === lemma)) continue;
          words.push({
            key: lemma,
            lemma,
            pos: "NOUN",
            article: article as "de" | "het",
            glosses: [],
            zipf: 4,
            state: "learning",
            pKnown: 0.5,
            sentences: [{ text: s.text, target: [a, b], source: s.source }],
          });
        }
      }
      return buildTopicSession(
        { kinds: opts.kinds, sentences, words, size: opts.size ?? 10 },
        createRng(42),
      );
    },
  };
}
