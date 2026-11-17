import { describe, expect, it } from "vitest";
import { AnkiConnectClient } from "./client.js";
import type { DetectFn } from "./detect.js";
import { fakeAnki, type FakeNote } from "./fake-anki.test-util.js";
import { buildSnapshot } from "./snapshot.js";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 17);
const NL = new Set([
  "de fiets",
  "fiets",
  "lopen",
  "het huis",
  "zij, ze",
  "gezellig",
  "De fiets is rood.",
  "Wij lopen.",
  "Het huis is groot.",
]);
const detect: DetectFn = async (texts) =>
  texts.map((t) => ({ lang: NL.has(t) ? "nl" : /[a-z]/i.test(t) ? "en" : null, confidence: 0.9 }));
// mimics /analyze/terms: strip article, split alternatives
const analyzeTerms = async (terms: string[]) =>
  terms.map((t) => {
    const [head = "", ...alts] = t.split(/\s*,\s*/);
    const m = /^(de|het) (.+)$/.exec(head);
    return { key: (m ? m[2]! : head).toLowerCase(), aliases: alts, article: m ? m[1]! : null };
  });

const notes: FakeNote[] = [
  {
    id: 1,
    deck: "NL",
    model: "Woord",
    fields: {
      Woord: "de fiets",
      Betekenis: "bike",
      Zin: "De <b>fiets</b> is rood.<br>Tweede regel.",
      ZinEN: "The bike is red.<br>Second.",
    },
    cards: [30, 5],
    lastReview: NOW - 10 * DAY,
  },
  {
    id: 2,
    deck: "NL",
    model: "Woord",
    fields: {
      Woord: "lopen",
      Betekenis: "to walk",
      Zin: "Wij lopen. Echt waar.",
      ZinEN: "We walk. Really.",
    },
    cards: [3],
    lastReview: NOW - 3 * DAY,
  },
  {
    id: 3,
    deck: "NL",
    model: "Woord",
    fields: {
      Woord: "het huis",
      Betekenis: "house",
      Zin: "Het huis is groot.",
      ZinEN: "The house is big.",
    },
    cards: [0],
  },
  {
    id: 4,
    deck: "Freq",
    model: "Freq",
    fields: { Word: "fiets", Definition: "bicycle", Rank: "12" },
    cards: [2],
    lastReview: NOW - 1 * DAY,
  },
  {
    id: 5,
    deck: "Freq",
    model: "Freq",
    fields: { Word: "zij, ze", Definition: "she", Rank: "13" },
    cards: [0],
  },
  {
    id: 6,
    deck: "Freq",
    model: "Freq",
    fields: { Word: "gezellig", Definition: "cozy", Rank: "14" },
    cards: [0],
  },
  ...Array.from({ length: 12 }, (_, i) => ({
    id: 100 + i,
    deck: "Bio",
    model: "Basic",
    fields: { Front: "enzyme", Back: "protein" },
    cards: [10],
  })),
];

describe("buildSnapshot", () => {
  it("detects decks, merges keys across decks and keeps gloss/article", async () => {
    const anki = new AnkiConnectClient({ fetch: fakeAnki(notes) });
    const snap = await buildSnapshot({
      anki,
      lang: "nl",
      detect,
      analyzeTerms,
      decks: ["NL", "Freq", "Bio"],
      now: NOW,
    });
    expect(snap.sources.map((s) => s.deck).sort()).toEqual(["Freq", "NL"]);
    const byKey = new Map(snap.entries.map((e) => [e.key, e]));
    const fiets = byKey.get("fiets")!;
    expect(fiets.state).toBe("known");
    expect(fiets.decks.sort()).toEqual(["Freq", "NL"]);
    expect(fiets.noteIds.sort()).toEqual([1, 4]);
    expect(fiets.article).toBe("de");
    expect(fiets.gloss).toBe("bike");
    expect(fiets.sentence).toBe("De fiets is rood.");
    expect(fiets.sentenceTranslation).toBe("The bike is red.");
    expect(byKey.get("lopen")!.sentence).toBe("Wij lopen.");
    expect(byKey.get("lopen")!.sentenceTranslation).toBe("We walk.");
    expect(byKey.get("gezellig")!.sentence).toBeUndefined();
    expect(snap.sources.find((x) => x.deck === "NL")!.sentenceTranslationField).toBe("ZinEN");
    expect(byKey.get("lopen")!.state).toBe("learning");
    expect(byKey.get("huis")!.state).toBe("unknown");
    expect(byKey.get("ze")?.state).toBe("unknown"); // alias
    expect(snap.reviewedCards).toBe(4);
    expect(snap.fsrsCards).toBe(0);
  });

  it("fails clearly when no target-language deck exists", async () => {
    const anki = new AnkiConnectClient({ fetch: fakeAnki(notes.filter((n) => n.deck === "Bio")) });
    await expect(buildSnapshot({ anki, lang: "nl", detect, analyzeTerms })).rejects.toThrow(
      /No nl vocabulary/,
    );
  });
});
