/**
 * Graded stories that ship with the app (`content/stories`, bundled by
 * `server/nlp/scripts/check_stories.py --write`): a chunk of its own, loaded on first use and
 * cached, so the Stories shelf works offline. Each story carries its spaCy analysis, so its
 * coverage is known before it is opened and it reads without the language server, and an
 * English line per Dutch sentence for side by side.
 */
import { type AnalyzedToken, type LearnerModel, classifyTokens, coverageOf } from "@app/core";

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
];

interface PackedStory extends Omit<BundledStory, "tokens" | "level" | "kind" | "sentences"> {
  level: string;
  kind: string;
  sentences: (string | number)[][];
  tokens: PackedToken[];
}

/** Unpack a bundled story. */
function unpackStory(p: PackedStory): BundledStory {
  const tokens = p.tokens.map(
    ([lemma, alt, pos, morph, dep, head, sent, start, end, flags, particleOf, zipf], i) => ({
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
      particle_of: particleOf,
      zipf,
    }),
  );
  return {
    ...p,
    level: p.level as StoryLevel,
    kind: p.kind as BundledStory["kind"],
    sentences: p.sentences.map(([a, b, en]) => [Number(a), Number(b), String(en)]),
    tokens,
  };
}

let stories: Promise<BundledStory[]> | null = null;

/** Every bundled story, by level (A1 first), then legend, classic, original. */
export function loadStories(): Promise<BundledStory[]> {
  stories ??= import("../../../../content/stories/stories.json").then((m) =>
    (m.default as unknown as { stories: PackedStory[] }).stories.map(unpackStory),
  );
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

/** Share of the story's words the learner knows (the reader's coverage rule). */
function storyCoverage(story: Pick<BundledStory, "tokens">, model: LearnerModel): number {
  return coverageOf(classifyTokens(story.tokens, model), story.tokens);
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
