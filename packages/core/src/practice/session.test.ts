import { describe, expect, it } from "vitest";
import { createRng } from "./rng.js";
import { buildSession } from "./session.js";
import { itemState, sentence, word } from "./testutil.js";
import type { SessionOptions, WordData } from "./types.js";

const NOW = 1_000_000;
const opts = (over: Partial<SessionOptions> = {}): SessionOptions => ({
  size: 20,
  newItems: 8,
  now: NOW,
  ...over,
});

/** n nouns with article, glosses and a sentence: supports recognition, gender, recall, form, listening. */
function vocab(n: number, over: Partial<WordData> = {}): WordData[] {
  return Array.from({ length: n }, (_, i) => {
    const lemma = `woord${i}`;
    return word(lemma, {
      article: i % 2 ? "de" : "het",
      glosses: [`meaning ${i}`],
      sentences: [sentence(`Dit is een mooi ${lemma} voor mij.`, lemma)],
      ...over,
    });
  });
}

describe("buildSession", () => {
  it("with no states offers only new items up to the cap", () => {
    const words = vocab(10);
    const s = buildSession(words, [], opts({ newItems: 5 }), createRng(1));
    expect(s).toHaveLength(5);
  });

  it("returns due items first, most overdue first (before new items)", () => {
    const words = vocab(10);
    const states = [
      itemState("woord0", "gender", { due: NOW - 10 }),
      itemState("woord1", "gender", { due: NOW - 500 }),
      itemState("woord2", "gender", { due: NOW - 100 }),
      itemState("woord3", "gender", { due: NOW + 9999 }),
    ];
    const s = buildSession(words, states, opts({ newItems: 3 }), createRng(1));
    // The due trio, all gender; different keys, so spread keeps priority order.
    expect(s.slice(0, 3).map((e) => e.key)).toEqual(["woord1", "woord2", "woord0"]);
    expect(s.slice(0, 3).every((e) => e.skill === "gender")).toBe(true);
    // Then 3 new pairs, then the not-yet-due pair as filler.
    const rest = s.slice(3);
    expect(rest).toHaveLength(4);
    expect(rest.slice(0, 3).some((e) => e.key === "woord3" && e.skill === "gender")).toBe(false);
    expect(rest[3]).toMatchObject({ key: "woord3", skill: "gender" });
  });

  it("caps new items and never re-offers tracked pairs as new", () => {
    const words = vocab(6);
    const states = words.flatMap((w) => [
      itemState(w.key, "recognition", { due: NOW + 1 }),
      itemState(w.key, "gender", { due: NOW + 1 }),
      itemState(w.key, "form", { due: NOW + 1 }),
      itemState(w.key, "recall", { due: NOW + 1 }),
    ]);
    const s = buildSession(words, states, opts({ size: 50, newItems: 4 }), createRng(1));
    const newOnes = s.filter((e) => e.skill === "listening");
    expect(newOnes.length).toBeLessThanOrEqual(4);
    expect(newOnes.length).toBeGreaterThan(0);
  });

  it("fills up to size with not-yet-due pairs, soonest first, after due and new", () => {
    const words = vocab(3);
    const states = [
      itemState("woord0", "gender", { due: NOW + 20 }),
      itemState("woord1", "gender", { due: NOW + 10 }),
    ];
    const s = buildSession(
      words,
      states,
      opts({ size: 4, newItems: 1, skills: ["gender"] }),
      createRng(1),
    );
    expect(s.map((e) => e.key)).toEqual(["woord2", "woord1", "woord0"]);
  });

  it("never exceeds size", () => {
    const s = buildSession(vocab(30), [], opts({ size: 6, newItems: 20 }), createRng(1));
    expect(s.length).toBe(6);
  });

  it("prefers learning words with low pKnown, then known; skips ignored", () => {
    const words = [
      word("kn", { state: "known", pKnown: 0.95, article: "de" }),
      word("lo", { state: "learning", pKnown: 0.2, article: "de" }),
      word("hi", { state: "learning", pKnown: 0.7, article: "de" }),
      word("ig", { state: "ignored", article: "de" }),
    ];
    const s = buildSession(words, [], opts({ newItems: 3, skills: ["gender"] }), createRng(1));
    expect(s.map((e) => e.key).sort()).toEqual(["hi", "kn", "lo"]);
    const s2 = buildSession(words, [], opts({ newItems: 1, skills: ["gender"] }), createRng(1));
    expect(s2.map((e) => e.key)).toEqual(["lo"]);
  });

  it("respects the skills filter", () => {
    const s = buildSession(vocab(5), [], opts({ skills: ["gender", "listening"] }), createRng(1));
    expect(s.length).toBeGreaterThan(0);
    expect(s.every((e) => e.skill === "gender" || e.skill === "listening")).toBe(true);
  });

  it("skips skills a word cannot support", () => {
    const bare = [word("kaal", { pos: "ADJ" })]; // no article, sentences, forms, glosses to speak? lemma works
    const s = buildSession(bare, [], opts(), createRng(1));
    expect(s.map((e) => e.skill)).toEqual(["listening"]);
  });

  it("drops due items whose word is unknown to the session", () => {
    const s = buildSession(
      vocab(1),
      [itemState("ghost", "gender", { due: 0 })],
      opts({ newItems: 0 }),
      createRng(1),
    );
    expect(s).toEqual([]);
  });

  it("avoids the same key twice in a row when alternatives exist", () => {
    const words = vocab(6);
    const states = words.flatMap((w) => [
      itemState(w.key, "gender", { due: NOW - 5 }),
      itemState(w.key, "listening", { due: NOW - 5 }),
    ]);
    for (let seed = 1; seed <= 5; seed++) {
      const s = buildSession(words, states, opts({ newItems: 0 }), createRng(seed));
      expect(s).toHaveLength(12);
      for (let i = 1; i < s.length; i++) expect(s[i]!.key).not.toBe(s[i - 1]!.key);
    }
  });

  it("interleaves skills where possible and varies kinds", () => {
    const words = vocab(8);
    const s = buildSession(words, [], opts({ size: 20, newItems: 16 }), createRng(3));
    expect(new Set(s.map((e) => e.skill)).size).toBeGreaterThanOrEqual(4);
    expect(
      new Set(s.filter((e) => e.skill === "recognition").map((e) => e.kind)).size,
    ).toBeGreaterThan(1);
    for (let i = 1; i < s.length; i++) expect(s[i]!.key).not.toBe(s[i - 1]!.key);
  });

  it("is deterministic for a given seed", () => {
    const words = vocab(8);
    const states = [itemState("woord1", "gender", { due: NOW - 1 })];
    const a = buildSession(words, states, opts(), createRng(11));
    const b = buildSession(words, states, opts(), createRng(11));
    expect(a).toEqual(b);
    const c = buildSession(words, states, opts(), createRng(12));
    expect(c).not.toEqual(a);
  });

  it("handles empty input", () => {
    expect(buildSession([], [], opts(), createRng(1))).toEqual([]);
  });
});
