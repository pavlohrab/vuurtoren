/**
 * Graded stories that ship with the app (`content/stories`, bundled by
 * `server/nlp/scripts/check_stories.py --write`): a chunk of its own, loaded on first use and
 * cached, so the Stories shelf works offline. Each story carries its spaCy analysis, so its
 * coverage is known before it is opened and it reads without the language server, and an
 * English line per Dutch sentence for side by side. The build also ships each sentence's word
 * pairs (the language server's `/translate/pairs` with the story's English given) and the
 * text's grammar hits (`/grammar`), so side by side, its structure view and the grammar marks
 * work without the server too (see `storyExtras`).
 */
import { grammarLevel, roughTextLevel } from "./textLevel.js";
import {
  type AnalyzedToken,
  type GrammarHit,
  type LearnerModel,
  classifyTokens,
  coverageOf,
  isCounted,
} from "@app/core";

export const STORY_LEVELS = ["A1", "A2", "B1", "B2"] as const;
export type StoryLevel = (typeof STORY_LEVELS)[number];

/** Below this coverage a story is "a stretch" (the reader's graded threshold). */
const STRETCH_BELOW = 0.95;

export interface BundledStory {
  slug: string;
  title: string;
  level: StoryLevel;
  words: number;
  /** One English sentence. */
  summary: string;
  kind: "legend" | "classic" | "original";
  /** For a retelling: the original work and its author. */
  credit?: string;
  licence: string;
  review: string;
  /** The Dutch text: sentences joined by a space, paragraphs by a blank line. */
  content: string;
  /** Each Dutch sentence's [start, end) in `content` and its English. */
  sentences: [number, number, string][];
  analyzerVersion: string;
  tokens: AnalyzedToken[];
  /**
   * Precomputed word pairs per sentence (`AnalyzedToken.sent`), as the server answers them:
   * `nl` indexes the sentence's word tokens, `en` the English tokens. Null for a sentence with
   * words the build had no English for; missing when the bundle has none (or they are stale).
   */
  pairs?: (StoryPair[] | null)[];
  /** The English the pairs index where it differs from the story's ("" when rejected). */
  pairsEnglish?: Record<string, string>;
  /** Precomputed grammar hits of the text (`/grammar`); missing like `pairs`. */
  grammar?: GrammarHit[];
}

/** A precomputed word pair: indices into the sentence's words and into its English tokens. */
export interface StoryPair {
  nl: number[];
  en: number[];
  confidence: number;
}

/** The layout of the bundle's pairs and grammar hits this app reads (`story_extras.py`). */
const EXTRAS_FORMAT = 1;

/** The versions the bundle's pairs and hits were computed with. */
interface ExtrasMeta {
  format: number;
  analyzerVersion: string;
  model: string;
  pairer: string;
}

/** A token as bundled: AnalyzedToken without `i` and `text` (index and content slice). */
type PackedToken = [
  lemma: string,
  alt: string[],
  pos: string,
  morph: string,
  dep: string,
  head: number,
  sent: number,
  start: number,
  end: number,
  flags: number,
  particleOf: number | null,
  zipf: number,
  /** The sentence structure's parse (SyntaxDot): pos, morph, dep, head, lemma, particle_of. */
  syn?: [string, string, string, number, string, number | null] | null,
];

interface PackedStory extends Omit<
  BundledStory,
  "tokens" | "level" | "kind" | "sentences" | "pairs" | "grammar"
> {
  level: string;
  kind: string;
  sentences: (string | number)[][];
  tokens: PackedToken[];
  /** Per sentence: [nl word indices, en token indices, confidence] per pair, or null. */
  pairs?: ([number[], number[], number][] | null)[];
  /** [topic, token indices, note?] per hit. */
  grammar?: [string, number[], string?][];
}

/** The grammar hits of a story, their sentence and its span taken from the tokens. */
function unpackGrammar(
  packed: NonNullable<PackedStory["grammar"]>,
  tokens: readonly AnalyzedToken[],
): GrammarHit[] {
  const span = new Map<number, [number, number]>();
  for (const t of tokens) {
    const had = span.get(t.sent);
    span.set(t.sent, had ? [had[0], t.end] : [t.start, t.end]);
  }
  const out: GrammarHit[] = [];
  for (const [topic, idx, note] of packed) {
    const sent = tokens[idx[0] ?? -1]?.sent;
    const s = sent === undefined ? undefined : span.get(sent);
    if (sent === undefined || !s || !idx.every((i) => tokens[i]?.sent === sent)) continue;
    out.push({ topic, tokens: idx, sent, start: s[0], end: s[1], note: note ?? "" });
  }
  return out;
}

/** Unpack a bundled story; its pairs and hits only when computed for its own analysis. */
function unpackStory(p: PackedStory, extras?: ExtrasMeta): BundledStory {
  const tokens = p.tokens.map(
    ([lemma, alt, pos, morph, dep, head, sent, start, end, flags, particleOf, zipf, syn], i) => ({
      i,
      text: p.content.slice(start, end),
      lemma,
      alt_lemmas: alt,
      pos,
      morph,
      dep,
      head,
      sent,
      start,
      end,
      is_word: (flags & 1) !== 0,
      is_propn: (flags & 2) !== 0,
      is_num: (flags & 4) !== 0,
      unlisted: (flags & 8) !== 0,
      particle_of: particleOf,
      zipf,
      ...(syn
        ? {
            syn: {
              pos: syn[0],
              morph: syn[1],
              dep: syn[2],
              head: syn[3],
              lemma: syn[4],
              particle_of: syn[5],
            },
          }
        : {}),
    }),
  );
  const { pairs, grammar, pairsEnglish, ...rest } = p;
  const fresh = extras?.format === EXTRAS_FORMAT && extras.analyzerVersion === p.analyzerVersion;
  return {
    ...rest,
    level: p.level as StoryLevel,
    kind: p.kind as BundledStory["kind"],
    sentences: p.sentences.map(([a, b, en]) => [Number(a), Number(b), String(en)]),
    tokens,
    ...(fresh && pairs
      ? {
          pairs: pairs.map(
            (ps) => ps?.map(([nl, en, confidence]) => ({ nl, en, confidence })) ?? null,
          ),
          ...(pairsEnglish ? { pairsEnglish } : {}),
        }
      : {}),
    ...(fresh && grammar ? { grammar: unpackGrammar(grammar, tokens) } : {}),
  };
}

let stories: Promise<BundledStory[]> | null = null;

/** Every bundled story, by level (A1 first), then legend, classic, original. */
export function loadStories(): Promise<BundledStory[]> {
  stories ??= import("../../../../content/stories/stories.json").then((m) => {
    const bundle = m.default as unknown as { stories: PackedStory[]; extras?: ExtrasMeta };
    return bundle.stories.map((p) => unpackStory(p, bundle.extras));
  });
  return stories;
}

/** The Library text's source ref for a story. */
export const storyRef = (slug: string): string => `story:${slug}`;

/** The story slug of a text's source ref, or null for any other text. */
export function storySlugOf(ref: string | null | undefined): string | null {
  return ref?.startsWith("story:") ? ref.slice("story:".length) || null : null;
}

/**
 * The story's English per sentence of an analysis of its text: each English line goes to the
 * sentence holding the first word of its Dutch sentence (several lines in one analysed sentence
 * are joined). An analysis of another text gives nothing.
 */
export function storyEnglish(
  story: Pick<BundledStory, "content" | "sentences">,
  content: string,
  tokens: readonly AnalyzedToken[],
): Map<number, string> {
  const out = new Map<number, string>();
  if (content !== story.content) return out;
  const words = tokens.filter((t) => t.is_word);
  let k = 0;
  for (const [start, end, en] of story.sentences) {
    while (k < words.length && words[k]!.start < start) k++;
    const first = words[k];
    if (!first || first.start >= end) continue;
    const had = out.get(first.sent);
    out.set(first.sent, had ? `${had} ${en}` : en);
  }
  return out;
}

/**
 * Whether `tokens` are the story's own analysis, which the precomputed pairs and hits index (a
 * text analysed again by a newer language server may split it differently).
 */
function sameAnalysis(
  story: Pick<BundledStory, "content" | "tokens">,
  content: string,
  tokens: readonly AnalyzedToken[],
): boolean {
  if (content !== story.content || tokens.length !== story.tokens.length) return false;
  return tokens.every((t, k) => {
    const b = story.tokens[k]!;
    return (
      t.start === b.start &&
      t.end === b.end &&
      t.sent === b.sent &&
      t.is_word === b.is_word &&
      t.particle_of === b.particle_of
    );
  });
}

/** One sentence's precomputed English and pairs (`nl` = word indices within the sentence). */
export interface StorySentencePairs {
  english: string;
  pairs: StoryPair[];
}

/**
 * The precomputed English and pairs per sentence of an analysis of the story's text: empty for
 * another text or analysis, and without the sentences the build had no English for.
 */
export function storyPairs(
  story: Pick<BundledStory, "content" | "sentences" | "tokens" | "pairs" | "pairsEnglish">,
  content: string,
  tokens: readonly AnalyzedToken[],
): Map<number, StorySentencePairs> {
  const out = new Map<number, StorySentencePairs>();
  if (!story.pairs || !sameAnalysis(story, content, tokens)) return out;
  const english = storyEnglish(story, content, tokens);
  story.pairs.forEach((pairs, sent) => {
    const en = story.pairsEnglish?.[String(sent)] ?? english.get(sent);
    // A sentence without a line has no words (a quote on its own): no English, nothing to ask.
    if (pairs) out.set(sent, { english: en ?? "", pairs: en ? pairs : [] });
  });
  return out;
}

/** The precomputed grammar hits of an analysis of the story's text, or null (ask the server). */
export function storyGrammar(
  story: Pick<BundledStory, "content" | "tokens" | "grammar">,
  content: string,
  tokens: readonly AnalyzedToken[],
): GrammarHit[] | null {
  return story.grammar && sameAnalysis(story, content, tokens) ? story.grammar : null;
}

/** Share of the story's words the learner knows (the reader's coverage rule). */
function storyCoverage(story: Pick<BundledStory, "tokens">, model: LearnerModel): number {
  return coverageOf(classifyTokens(story.tokens, model), story.tokens);
}

/** How many different words of the story are new to the learner (as a text's "N new"). */
function storyNewWords(story: Pick<BundledStory, "tokens">, model: LearnerModel): number {
  const planned = classifyTokens(story.tokens, model);
  const keys = new Set<string>();
  planned.forEach((p, k) => {
    const t = story.tokens[k];
    if (p.label === "new" && p.key && t && isCounted(t, p)) keys.add(p.key);
  });
  return keys.size;
}

/** One cover of the Stories shelf. */
export interface StoryCover {
  slug: string;
  title: string;
  level: StoryLevel;
  words: number;
  summary: string;
  kind: BundledStory["kind"];
  credit?: string;
  /** Share of the story's words the learner knows. */
  coverage: number;
  /** Different words in it that are new to the learner. */
  newWords: number;
  /** Its words' level from the frequency bands, and its grammar's level (LV8). */
  wordsLevel: string | null;
  grammarLevel: string | null;
  /** Above the learner's comfort level: visible, but marked. */
  stretch: boolean;
  /** The Library text once the story was opened, else null. */
  textId: string | null;
}

/** The shelf's covers, with the learner's coverage and the Library text of opened stories. */
export function storyCovers(
  list: readonly BundledStory[],
  model: LearnerModel,
  texts: readonly { id: string; sourceRef?: string | undefined }[],
  /** The starter list's ranks, for the words' level (LV8); without them it is left out. */
  rank: ReadonlyMap<string, number> | null = null,
): StoryCover[] {
  const opened = new Map<string, string>();
  for (const t of texts) {
    const slug = storySlugOf(t.sourceRef);
    if (slug && !opened.has(slug)) opened.set(slug, t.id);
  }
  return list.map((s) => {
    const coverage = storyCoverage(s, model);
    return {
      slug: s.slug,
      title: s.title,
      level: s.level,
      words: s.words,
      summary: s.summary,
      kind: s.kind,
      ...(s.credit ? { credit: s.credit } : {}),
      coverage,
      newWords: storyNewWords(s, model),
      wordsLevel: rank ? roughTextLevel(s.tokens, rank) : null,
      grammarLevel: grammarLevel(s.grammar ?? []),
      stretch: coverage < STRETCH_BELOW,
      textId: opened.get(s.slug) ?? null,
    };
  });
}

/**
 * The learner's story level: the highest level with a story that is not a stretch for them (A1
 * when every story is still a stretch).
 */
function learnerStoryLevel(covers: readonly StoryCover[]): StoryLevel {
  const easy = covers.filter((c) => !c.stretch).map((c) => STORY_LEVELS.indexOf(c.level));
  return STORY_LEVELS[easy.length ? Math.max(...easy) : 0]!;
}

/**
 * The shelf's rows: one per level that has stories, the learner's level first ("A1 · Start
 * here" for a beginner, else "A2 · Your level"), then the others from A1 up.
 */
export function storyRows(
  covers: readonly StoryCover[],
): { level: StoryLevel; name: string; covers: StoryCover[] }[] {
  const mine = learnerStoryLevel(covers);
  const order = [mine, ...STORY_LEVELS.filter((l) => l !== mine)];
  return order
    .map((level) => ({
      level,
      name: level !== mine ? level : level === "A1" ? "A1 · Start here" : `${level} · Your level`,
      covers: covers.filter((c) => c.level === level),
    }))
    .filter((r) => r.covers.length > 0);
}

/**
 * The story to start with: the first story of the learner's level not opened yet, a comfortable
 * one before a stretch. Null when every story of that level is in the Library.
 */
export function storyToStart(covers: readonly StoryCover[]): StoryCover | null {
  const level = learnerStoryLevel(covers);
  const open = covers.filter((c) => c.level === level && c.textId === null);
  return open.find((c) => !c.stretch) ?? open[0] ?? null;
}
