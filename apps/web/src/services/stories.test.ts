import type { AnalyzedToken, LearnerModel } from "@app/core";
import { createRepository } from "@app/db";
import { createNodeDriver } from "@app/db/node";
import { describe, expect, it } from "vitest";
import { createLiveStories } from "./liveStories.js";
import {
  type BundledStory,
  STORY_LEVELS,
  loadStories,
  storyCovers,
  storyEnglish,
  storyRows,
  storyToStart,
  storySlugOf,
} from "./stories.js";

/** Naive analysis: a token per word or full stop, a sentence ends at a full stop. */
function analyse(text: string): AnalyzedToken[] {
  const out: AnalyzedToken[] = [];
  let sent = 0;
  for (const m of text.matchAll(/\p{L}+|[.]/gu)) {
    const word = m[0] !== ".";
    out.push({
      i: out.length,
      text: m[0],
      lemma: m[0].toLowerCase(),
      alt_lemmas: [],
      pos: word ? "NOUN" : "PUNCT",
      morph: "",
      dep: "",
      head: out.length,
      sent,
      start: m.index,
      end: m.index + m[0].length,
      is_word: word,
      is_propn: m[0] === "Sam",
      is_num: false,
      particle_of: null,
      zipf: 5,
    });
    if (!word) sent += 1;
  }
  return out;
}

function story(over: Partial<BundledStory> & { content: string }): BundledStory {
  return {
    slug: "s",
    title: "S",
    level: "A1",
    words: 0,
    summary: "",
    kind: "original",
    licence: "CC BY-SA 4.0",
    review: "needs-native-review",
    sentences: [],
    analyzerVersion: "a1-test",
    tokens: analyse(over.content),
    ...over,
  };
}

const known = (...keys: string[]): LearnerModel =>
  new Map(keys.map((k) => [k, { state: "known" as const, pKnown: 1 }]));

describe("stories", () => {
  it("reads the slug of a story's source ref only", () => {
    expect(storySlugOf("story:klaas-vaak")).toBe("klaas-vaak");
    expect(storySlugOf("course:x:1")).toBeNull();
    expect(storySlugOf(undefined)).toBeNull();
  });

  it("gives each analysed sentence the English of the lines that start in it", () => {
    const content = "Sam slaapt. Hij droomt.\n\nHet is dag.";
    const s = story({
      content,
      sentences: [
        [0, 11, "Sam is asleep."],
        [12, 23, "He is dreaming."],
        [25, 36, "It is day."],
      ],
    });
    expect([...storyEnglish(s, content, analyse(content))]).toEqual([
      [0, "Sam is asleep."],
      [1, "He is dreaming."],
      [2, "It is day."],
    ]);
    // An analysis that joins two lines into one sentence gets both lines.
    const joined = analyse(content).map((t) => (t.sent === 1 ? { ...t, sent: 0 } : t));
    expect(storyEnglish(s, content, joined).get(0)).toBe("Sam is asleep. He is dreaming.");
    // Another text gets nothing.
    expect(storyEnglish(s, "Iets anders.", analyse("Iets anders.")).size).toBe(0);
  });

  it("groups covers by level, A1 first, with the learner's coverage and a stretch mark", () => {
    const easy = story({ slug: "easy", level: "A1", content: "Sam slaapt." });
    const hard = story({ slug: "hard", level: "B1", content: "Het onweer raast." });
    const mid = story({ slug: "mid", level: "A2", content: "Sam slaapt niet." });
    const covers = storyCovers([hard, easy, mid], known("slapen", "slaapt", "niet"), [
      { id: "t1", sourceRef: "story:mid" },
      { id: "t2", sourceRef: "talk:1" },
    ]);
    const by = Object.fromEntries(covers.map((c) => [c.slug, c]));
    // Names are not counted: "Sam slaapt" is all known.
    expect(by.easy).toMatchObject({ coverage: 1, stretch: false, textId: null });
    expect(by.mid).toMatchObject({ coverage: 1, textId: "t1" });
    expect(by.hard).toMatchObject({ coverage: 0, stretch: true });
    expect(storyRows(covers).map((r) => [r.name, r.covers.map((c) => c.slug)])).toEqual([
      ["A2 · Your level", ["mid"]],
      ["A1", ["easy"]],
      ["B1", ["hard"]],
    ]);
    // The story to start with: the learner's level, not opened yet.
    expect(storyToStart(covers)).toBeNull();
    const beginner = storyCovers([hard, easy, mid], known(), []);
    expect(storyRows(beginner)[0]?.name).toBe("A1 · Start here");
    expect(storyToStart(beginner)?.slug).toBe("easy");
  });

  it("bundles every level, with one English line per Dutch sentence", async () => {
    const list = await loadStories();
    for (const level of STORY_LEVELS) {
      expect(list.filter((s) => s.level === level).length).toBeGreaterThanOrEqual(3);
    }
    for (const s of list) {
      expect(s.sentences.length).toBeGreaterThan(0);
      for (const [a, b, en] of s.sentences) {
        expect(s.content.slice(a, b).trim()).not.toBe("");
        expect(en).not.toBe("");
      }
      // The bundled analysis gives every line its own sentence.
      expect(storyEnglish(s, s.content, s.tokens).size).toBe(s.sentences.length);
      expect(s.tokens.every((t) => t.text === s.content.slice(t.start, t.end))).toBe(true);
    }
  });
});

describe("opening a story", () => {
  it("adds it to the Library once, with its analysis, and finds the same text again", async () => {
    const repo = await createRepository(await createNodeDriver());
    const s = story({
      slug: "klaas",
      level: "A1",
      title: "Klaas",
      content: "Sam slaapt.",
      sentences: [[0, 11, "Sam is asleep."]],
    });
    const live = createLiveStories({
      repo,
      model: async () => known("slaapt"),
      lang: async () => "nl",
      stories: async () => [s],
    });
    const [a, b] = await Promise.all([
      live.services.openStory("klaas"),
      live.services.openStory("klaas"),
    ]);
    expect(b).toBe(a);
    expect(await live.services.openStory("klaas")).toBe(a);
    const texts = await repo.listTexts();
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatchObject({ title: "Klaas", sourceRef: "story:klaas", level: "A1" });
    const stored = await repo.getText(a);
    expect(stored?.tokens).toHaveLength(s.tokens.length);
    expect(stored?.analyzerVersion).toBe("a1-test");

    const [cover] = await live.services.storyShelf();
    expect(cover).toMatchObject({ slug: "klaas", textId: a, coverage: 1 });
    expect([...(await live.storyLines(stored!, stored!.tokens!))]).toEqual([[0, "Sam is asleep."]]);
  });
});
