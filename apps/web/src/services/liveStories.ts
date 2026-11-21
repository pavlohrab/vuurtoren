/**
 * The Stories shelf over the repository: the bundled graded stories with the learner's coverage,
 * and opening one, which adds it to the Library as a normal text (once) with its bundled
 * analysis, so it reads at once and offline, and the bundle's word pairs and grammar hits for
 * side by side and the grammar marks.
 */
import type { AnalyzedToken, GrammarHit, LearnerModel } from "@app/core";
import { type VuurtorenRepository, contentHash, createUlidGenerator } from "@app/db";
import {
  type BundledStory,
  type StoryCover,
  type StorySentencePairs,
  loadStories,
  storyCovers,
  storyEnglish,
  storyGrammar,
  storyPairs,
  storyRef,
  storySlugOf,
} from "./stories.js";

/** A Library text, as far as finding its story goes. */
type StoryTextRef = { content: string; sourceRef?: string | undefined };

export interface LiveStoriesDeps {
  repo: VuurtorenRepository;
  /** The learner model (cached by the learner cache). */
  model: () => Promise<LearnerModel>;
  /** The learner's language. */
  lang: () => Promise<string>;
  /** Bundled stories; the app's chunk by default (tests pass their own). */
  stories?: () => Promise<BundledStory[]>;
}

const nextUlid = createUlidGenerator();

export function createLiveStories(deps: LiveStoriesDeps) {
  const stories = deps.stories ?? loadStories;
  const opening = new Map<string, Promise<string>>();

  async function storyShelf(): Promise<StoryCover[]> {
    const [list, model, texts] = await Promise.all([
      stories(),
      deps.model(),
      deps.repo.listTexts(),
    ]);
    return storyCovers(list, model, texts);
  }

  async function addStory(slug: string): Promise<string> {
    const had = (await deps.repo.listTexts()).find((t) => storySlugOf(t.sourceRef) === slug);
    if (had) return had.id;
    const story = (await stories()).find((s) => s.slug === slug);
    if (!story) throw new Error(`There is no story "${slug}".`);
    const textId = nextUlid();
    await deps.repo.append({
      type: "TextImported",
      textId,
      title: story.title,
      lang: await deps.lang(),
      source: { kind: "paste", ref: storyRef(slug) },
      content: story.content,
    });
    await deps.repo.append({ type: "TextMetaUpdated", textId, patch: { level: story.level } });
    await deps.repo.saveTextAnalysis({
      textId,
      contentHash: contentHash(story.content),
      tokens: story.tokens,
      analyzerVersion: story.analyzerVersion,
    });
    return textId;
  }

  /** The Library text of the story: added on first open, the same text afterwards. */
  function openStory(slug: string): Promise<string> {
    const running = opening.get(slug);
    if (running) return running;
    const p = addStory(slug).finally(() => opening.delete(slug));
    opening.set(slug, p);
    return p;
  }

  /** The story's English per analysed sentence of a text (empty for any other text). */
  async function storyLines(
    text: { content: string; sourceRef?: string | undefined },
    tokens: Parameters<typeof storyEnglish>[2],
  ): Promise<Map<number, string>> {
    const slug = storySlugOf(text.sourceRef);
    if (!slug) return new Map();
    const story = (await stories()).find((s) => s.slug === slug);
    return story ? storyEnglish(story, text.content, tokens) : new Map();
  }

  async function storyOf(text: StoryTextRef): Promise<BundledStory | null> {
    const slug = storySlugOf(text.sourceRef);
    if (!slug) return null;
    return (await stories()).find((s) => s.slug === slug) ?? null;
  }

  /** The bundle's English and word pairs per sentence of a story text (empty otherwise). */
  async function storySentencePairs(
    text: StoryTextRef,
    tokens: readonly AnalyzedToken[],
  ): Promise<Map<number, StorySentencePairs>> {
    const story = await storyOf(text);
    return story ? storyPairs(story, text.content, tokens) : new Map();
  }

  /** The bundle's grammar hits of a story text, or null (another text: ask the server). */
  async function storyTextGrammar(
    text: StoryTextRef,
    tokens: readonly AnalyzedToken[],
  ): Promise<GrammarHit[] | null> {
    const story = await storyOf(text);
    return story ? storyGrammar(story, text.content, tokens) : null;
  }

  return {
    services: { storyShelf, openStory },
    storyLines,
    storyPairs: storySentencePairs,
    storyGrammar: storyTextGrammar,
  };
}
