/**
 * The bundled stories' precomputed word pairs and grammar hits: side by side, its structure
 * view and the grammar marks work for a story with no language server at all.
 */
import { type SegmentPlan, type SentencePairs, wordOrderNote } from "@app/core";
import { createRepository } from "@app/db";
import { createNodeDriver } from "@app/db/node";
import type { NlpClient } from "@app/nlp-client";
import { SideBySide, type StructureNote } from "@app/ui";
import { render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createLiveGrammar } from "./liveGrammar.js";
import { createLivePairs, englishTokens } from "./livePairs.js";
import { createLiveStories } from "./liveStories.js";
import { chunkText } from "./liveTexts.js";
import { type BundledStory, loadStories, storyGrammar, storyPairs } from "./stories.js";
import type { ReadingView } from "./types.js";

const SLUG = "de-koe-op-de-toren";

/** A language server that is not there: every request fails. */
function noServer() {
  const calls = vi.fn();
  const fail = async () => {
    calls();
    throw new Error("fetch failed");
  };
  const client = { pairs: fail, grammar: fail } as unknown as NlpClient;
  return { calls, nlp: async () => client };
}

/** The story opened in a fresh Library, as the reader sees it. */
async function opened() {
  const repo = await createRepository(await createNodeDriver());
  const stories = createLiveStories({
    repo,
    model: async () => new Map(),
    lang: async () => "nl",
  });
  const textId = await stories.services.openStory(SLUG);
  const text = (await repo.getText(textId))!;
  const view = { text, tokens: text.tokens!, plans: [] } as unknown as ReadingView;
  return { repo, stories, textId, text, view };
}

/** Side by side's pairs, wired to the stories as in live.ts. */
function livePairs(
  view: ReadingView,
  stories: ReturnType<typeof createLiveStories>,
  nlp: () => Promise<NlpClient>,
) {
  return createLivePairs({
    view: async () => view,
    nlp,
    aiReady: () => false,
    aiTranslate: vi.fn(),
    storyLines: (v) => stories.storyLines(v.text, v.tokens),
    storyPairs: (v) => stories.storyPairs(v.text, v.tokens),
  });
}

let all: BundledStory[];
let story: BundledStory;
beforeAll(async () => {
  all = await loadStories();
  story = all.find((s) => s.slug === SLUG)!;
});

const wordsOf = (s: BundledStory, sent: number) =>
  s.tokens.filter((t) => t.sent === sent && t.is_word);

describe("precomputed story pairs and grammar", () => {
  it("every story brings pairs for every sentence and hits, on its own token indices", () => {
    for (const s of all) {
      const sents = new Set(s.tokens.map((t) => t.sent));
      expect(s.pairs, s.slug).toHaveLength(sents.size);
      const ready = storyPairs(s, s.content, s.tokens);
      expect(ready.size, s.slug).toBe(sents.size);
      for (const [sent, r] of ready) {
        const words = wordsOf(s, sent).length;
        const english = englishTokens(r.english).length;
        for (const p of r.pairs) {
          expect(p.nl.every((w) => w >= 0 && w < words)).toBe(true);
          expect(p.en.every((e) => e >= 0 && e < english)).toBe(true);
          expect(p.confidence).toBeGreaterThan(0);
          expect(p.confidence).toBeLessThanOrEqual(1);
          expect(Math.round(p.confidence * 100) / 100).toBe(p.confidence);
        }
      }
      expect(s.grammar?.length, s.slug).toBeGreaterThan(0);
      for (const h of s.grammar ?? []) {
        for (const i of h.tokens) {
          const t = s.tokens[i]!;
          expect(t.sent).toBe(h.sent);
          expect(t.start >= h.start && t.end <= h.end).toBe(true);
        }
      }
    }
  });

  it("are not used for another analysis of the text", () => {
    const other = story.tokens.map((t) => (t.sent === 1 ? { ...t, sent: 0 } : t));
    expect(storyPairs(story, story.content, other).size).toBe(0);
    expect(storyGrammar(story, story.content, other)).toBeNull();
    expect(storyGrammar(story, "Iets anders.", story.tokens)).toBeNull();
  });

  it("side by side pairs a story's words with no language server", async () => {
    const { view, stories } = await opened();
    const { calls, nlp } = noServer();
    const pairs = livePairs(view, stories, nlp);
    const out = await pairs.sentencePairs("t", [0, 1]);
    expect(calls).not.toHaveBeenCalled();
    const [first] = out;
    expect(first).toMatchObject({
      sent: 0,
      english: "Kampen is an old town by the water.",
      source: "story",
    });
    expect(first!.retry).toBeUndefined();
    // Pairs are on token indices: "stad" lights up "town" and back.
    const at = (w: string) => view.tokens.find((t) => t.text === w && t.sent === 0)!.i;
    const en = (p: SentencePairs, i: number) =>
      p.pairs.find((x) => x.nl.includes(i))?.en.map((e) => p.englishTokens[e]!.text);
    expect(en(first!, at("stad"))).toEqual(["town"]);
    expect(en(first!, at("water"))).toEqual(["water"]);
  });

  it("grammar hits of a story need no language server", async () => {
    const { repo, stories, textId, view } = await opened();
    const { calls, nlp } = noServer();
    const grammar = createLiveGrammar({
      repo,
      nlp,
      view: async () => view,
      model: async () => new Map(),
      chunkText,
      translate: async () => new Map(),
      storyGrammar: (t) => stories.storyGrammar(t, t.tokens ?? []),
    });
    const hits = await grammar.textGrammar(textId);
    expect(calls).not.toHaveBeenCalled();
    // "In Kampen staat een hoge kerk.": the verb comes before the subject.
    const inversion = hits.find((h) => h.topic === "inversion" && h.sent === 1);
    expect(inversion?.tokens.map((i) => view.tokens[i]!.text)).toEqual(["staat", "kerk"]);
    expect(inversion?.note).toMatch(/«In» comes first/);
    expect((await repo.textGrammar(textId))?.hits).toEqual(hits);
  });

  it("the structure view colours the pairs and adds the word-order note", async () => {
    const { view, stories } = await opened();
    const live = livePairs(view, stories, noServer().nlp);
    const pairs = new Map((await live.sentencePairs("t", [0, 1])).map((p) => [p.sent, p]));
    const tokens = view.tokens.filter((t) => t.sent <= 1);
    const plan: SegmentPlan = {
      segment: {
        index: 0,
        tokenStart: 0,
        tokenEnd: tokens.length,
        charStart: 0,
        charEnd: tokens.at(-1)!.end,
      },
      tokens: tokens.map((t) => ({
        i: t.i,
        label: t.is_word ? "known" : "nonword",
        key: t.is_word ? t.lemma : null,
        pKnown: 0.9,
      })),
      coverage: 0.9,
      newTypes: [],
      introduce: [],
      gloss: [],
      clozes: [],
    };
    const notes = new Map<number, StructureNote>();
    const n = wordOrderNote(story.grammar ?? [], 1, view.tokens);
    if (n) notes.set(1, { label: n.label, note: n.note });
    const { container } = render(
      <SideBySide
        text={view.text.content}
        tokens={view.tokens}
        plan={plan}
        pairs={pairs}
        notes={notes}
        visibility="always"
      />,
    );
    const second = container.querySelectorAll<HTMLElement>(".k-sbs-row")[1]!;
    await userEvent.click(within(second).getByRole("button", { name: "Structure" }));
    expect(second).toHaveAttribute("data-structure");
    const coloured = second.querySelectorAll('[data-side="nl"][data-pc]');
    expect(coloured.length).toBeGreaterThanOrEqual(4);
    expect(second.querySelectorAll('[data-side="en"][data-pc]').length).toBeGreaterThanOrEqual(4);
    expect(within(second).getByText(/«In» comes first/)).toBeInTheDocument();
  });
});
