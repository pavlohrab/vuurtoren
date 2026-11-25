/**
 * The Stories shelf over the repository: the bundled graded stories with the learner's coverage,
 * and opening one, which adds it to the Library as a normal text (once) with its bundled
 * analysis, so it reads at once and offline, and the bundle's word pairs and grammar hits for
 * side by side and the grammar marks.
 */
import type { AnalyzedToken, GrammarHit, LearnerModel } from "@app/core";
import { type VuurtorenRepository, contentHash } from "@app/db";
import { ALIGN_MIN_CONFIDENCE, type AlignedMeaning } from "./liveDictionary.js";
import { englishTokens } from "./livePairs.js";
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

export function createLiveStories(deps: LiveStoriesDeps) {
  const stories = deps.stories ?? loadStories;
  const opening = new Map<string, Promise<string>>();

  /**
   * Your texts, with one text per story. Each device used to make its own copy of a story, and
   * sync kept them all: the copies go now, the one read furthest stays (the lowest id on a tie,
   * so every device keeps the same one).
   */
  async function textsOnePerStory() {
    const texts = await deps.repo.listTexts();
    const bySlug = new Map<string, typeof texts>();
    for (const t of texts) {
      const slug = storySlugOf(t.sourceRef);
      if (slug) bySlug.set(slug, [...(bySlug.get(slug) ?? []), t]);
    }
    const gone = new Set<string>();
    for (const copies of bySlug.values()) {
      if (copies.length < 2) continue;
      const keep = [...copies].sort(
        (a, b) => b.lastSegment - a.lastSegment || (a.id < b.id ? -1 : 1),
      )[0]!;
      for (const t of copies) {
        if (t.id === keep.id) continue;
        await deps.repo.append({ type: "TextDeleted", textId: t.id });
        gone.add(t.id);
      }
    }
    return gone.size ? texts.filter((t) => !gone.has(t.id)) : texts;
  }

  async function storyShelf(): Promise<StoryCover[]> {
    const [list, model, texts] = await Promise.all([stories(), deps.model(), textsOnePerStory()]);
    return storyCovers(list, model, texts);
  }

  async function addStory(slug: string): Promise<string> {
    const had = (await textsOnePerStory()).find((t) => storySlugOf(t.sourceRef) === slug);
    if (had) return had.id;
    const story = (await stories()).find((s) => s.slug === slug);
    if (!story) throw new Error(`There is no story "${slug}".`);
    // The same id on every device, so sync sees one text, not one per device.
    const textId = `story:${await deps.lang()}:${slug}`;
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

  /**
   * A story word's English from the bundle's word pairs (no server): the words it pairs with, and
   * how sure the pairing is. Undefined for other texts, or a word with no pair.
   */
  async function storyAlign(
    text: StoryTextRef,
    tokens: AnalyzedToken[],
    i: number,
  ): Promise<AlignedMeaning | undefined> {
    const t = tokens[i];
    if (!t) return undefined;
    const sent = (await storySentencePairs(text, tokens)).get(t.sent);
    if (!sent?.english) return undefined;
    const words = tokens.filter((x) => x.sent === t.sent && x.is_word);
    const k = words.findIndex((x) => x.i === i);
    const pair = sent.pairs.find((p) => p.nl.includes(k));
    if (k < 0 || !pair?.en.length) return undefined;
    const en = englishTokens(sent.english);
    const words_ = pair.en.map((n) => en[n]?.text).filter(Boolean);
    if (!words_.length) return undefined;
    return {
      text: words_.join(" "),
      confident: pair.confidence >= ALIGN_MIN_CONFIDENCE,
      confidence: pair.confidence,
    };
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
    storyAlign,
    storyGrammar: storyTextGrammar,
  };
}
