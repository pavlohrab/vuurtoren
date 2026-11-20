/**
 * Side by side for the mock services: hand-aligned English for the sample texts (what the
 * language server's `/translate/pairs` gives for them), so `?demo` and the UI tests show
 * pairs. Sentences without an entry have no English. With the AI option a sentence may have a
 * second, AI-style English.
 */
import type { AnalyzedToken, SentencePairs } from "@app/core";
import { englishTokens } from "./livePairs.js";

/** [Dutch words (space-separated, in order), English words (space-separated, in order)] */
type PairSpec = [string, string];

interface SentenceSpec {
  en: string;
  pairs: PairSpec[];
  /** The English an AI provider might give, with its own pairs. */
  ai?: { en: string; pairs: PairSpec[] };
}

const SENTENCES: Record<string, SentenceSpec> = {
  "Morgen bel ik mijn moeder op.": {
    en: "Tomorrow I'll call my mom.",
    pairs: [
      ["Morgen", "Tomorrow"],
      ["bel op", "'ll call"],
      ["ik", "I"],
      ["mijn", "my"],
      ["moeder", "mom"],
    ],
    ai: {
      en: "Tomorrow I will ring up my mother.",
      pairs: [
        ["Morgen", "Tomorrow"],
        ["bel op", "will ring up"],
        ["ik", "I"],
        ["mijn", "my"],
        ["moeder", "mother"],
      ],
    },
  },
  "Omdat het gisteren zo hard regende, bleven we binnen.": {
    en: "Because it rained so hard yesterday, we stayed inside.",
    pairs: [
      ["Omdat", "Because"],
      ["het", "it"],
      ["gisteren", "yesterday"],
      ["zo", "so"],
      ["hard", "hard"],
      ["regende", "rained"],
      ["bleven", "stayed"],
      ["we", "we"],
      ["binnen", "inside"],
    ],
  },
  "We hebben samen een film gekeken.": {
    en: "We watched a movie together.",
    pairs: [
      ["We", "We"],
      ["gekeken", "watched"],
      ["een", "a"],
      ["film", "movie"],
      ["samen", "together"],
    ],
  },
  "De film die we kozen was erg grappig.": {
    en: "The movie we chose was very funny.",
    pairs: [
      ["De", "The"],
      ["film", "movie"],
      ["we", "we"],
      ["kozen", "chose"],
      ["was", "was"],
      ["erg", "very"],
      ["grappig", "funny"],
    ],
  },
  "Ik bel mijn zus op.": {
    en: "I'm calling my sister.",
    pairs: [
      ["Ik", "I"],
      ["bel op", "'m calling"],
      ["mijn", "my"],
      ["zus", "sister"],
    ],
  },
  "Ze woont in Utrecht, een mooie stad met veel grachten.": {
    en: "She lives in Utrecht, a beautiful city with many canals.",
    pairs: [
      ["Ze", "She"],
      ["woont", "lives"],
      ["in", "in"],
      ["Utrecht", "Utrecht"],
      ["een", "a"],
      ["mooie", "beautiful"],
      ["stad", "city"],
      ["met", "with"],
      ["veel", "many"],
      ["grachten", "canals"],
    ],
  },
  "Vandaag staat zij vroeg op omdat de trein om acht uur vertrekt.": {
    en: "Today she gets up early because the train leaves at eight o'clock.",
    pairs: [
      ["Vandaag", "Today"],
      ["staat op", "gets up"],
      ["zij", "she"],
      ["vroeg", "early"],
      ["omdat", "because"],
      ["de", "the"],
      ["trein", "train"],
      ["vertrekt", "leaves"],
      ["om", "at"],
      ["acht", "eight"],
      ["uur", "o 'clock"],
    ],
  },
  "Ze neemt een boek mee, want de reis duurt lang.": {
    en: "She takes a book with her, because the journey takes a long time.",
    pairs: [
      ["Ze", "She"],
      ["neemt mee", "takes with her"],
      ["een", "a"],
      ["boek", "book"],
      ["want", "because"],
      ["de", "the"],
      ["reis", "journey"],
      ["duurt", "takes"],
      ["lang", "long time"],
    ],
  },
  "De markt is elke zaterdag open.": {
    en: "The market is open every Saturday.",
    pairs: [
      ["De", "The"],
      ["markt", "market"],
      ["is", "is"],
      ["open", "open"],
      ["elke", "every"],
      ["zaterdag", "Saturday"],
    ],
  },
  "Mijn buurvrouw koopt daar verse kaas en brood.": {
    en: "My neighbour buys fresh cheese and bread there.",
    pairs: [
      ["Mijn", "My"],
      ["buurvrouw", "neighbour"],
      ["koopt", "buys"],
      ["verse", "fresh"],
      ["kaas", "cheese"],
      ["en", "and"],
      ["brood", "bread"],
      ["daar", "there"],
    ],
  },
  "Het regent al drie dagen.": {
    en: "It has been raining for three days.",
    pairs: [
      ["Het", "It"],
      ["regent", "has been raining"],
      ["al", "for"],
      ["drie", "three"],
      ["dagen", "days"],
    ],
  },
  "De wind is koud en de lucht is grijs.": {
    en: "The wind is cold and the sky is grey.",
    pairs: [
      ["De", "The"],
      ["wind", "wind"],
      ["is", "is"],
      ["koud", "cold"],
      ["en", "and"],
      ["de", "the"],
      ["lucht", "sky"],
      ["is", "is"],
      ["grijs", "grey"],
    ],
  },
  "Morgen wordt het misschien beter, zegt de weerman.": {
    en: "Tomorrow it may be better, says the weatherman.",
    pairs: [
      ["Morgen", "Tomorrow"],
      ["het", "it"],
      ["misschien", "may"],
      ["wordt", "be"],
      ["beter", "better"],
      ["zegt", "says"],
      ["de", "the"],
      ["weerman", "weatherman"],
    ],
  },
};

/**
 * Indices of `words` in `items` (compared case-insensitively), each word taken at its first
 * occurrence not used yet, so a repeated word ("is … is") pairs with the next one.
 */
function take(items: readonly string[], words: string, used: Set<number>): number[] {
  const out: number[] = [];
  for (const w of words.split(" ")) {
    const k = items.findIndex((x, j) => !used.has(j) && x.toLowerCase() === w.toLowerCase());
    if (k < 0) return [];
    out.push(k);
  }
  for (const k of out) used.add(k);
  return out;
}

/** The English and pairs of one sentence of a mock text (its tokens, in order). */
export function mockSentencePairs(
  content: string,
  sent: number,
  tokens: readonly AnalyzedToken[],
  ai: boolean,
): SentencePairs {
  const start = tokens[0]?.start ?? 0;
  const text = content.slice(start, tokens[tokens.length - 1]?.end ?? start);
  const spec = SENTENCES[text];
  const use = ai && spec?.ai ? spec.ai : spec;
  if (!use) return { sent, english: "", englishTokens: [], pairs: [], source: "offline" };
  const english = englishTokens(use.en);
  const nlUsed = new Set<number>();
  const enUsed = new Set<number>();
  const surfaces = tokens.map((t) => t.text);
  const pairs = use.pairs.flatMap(([nl, en]) => {
    const n = take(surfaces, nl, nlUsed);
    const e = take(
      english.map((t) => t.text),
      en,
      enUsed,
    );
    return n.length && e.length ? [{ nl: n.map((k) => tokens[k]!.i), en: e, confidence: 0.9 }] : [];
  });
  return {
    sent,
    english: use.en,
    englishTokens: english,
    pairs,
    source: use === spec ? "offline" : "ai",
  };
}
