import { DEFAULT_DECK_OPTIONS, type NativeCard } from "@app/core";
import { describe, expect, it } from "vitest";
import type { NativeWordAddedEvent } from "./native.js";
import {
  type StarterWord,
  addStarterWords,
  openStarterLevel,
  starterDeck,
  starterLevelOf,
  starterLevelsHeld,
  startStarterFrom,
  starterBand,
  starterLevelName,
} from "./starter.js";

const WORDS: StarterWord[] = Array.from({ length: 1500 }, (_, i) => ({
  rank: i + 1,
  word: i === 4 ? "huis" : `woord${i + 1}`,
  pos: "noun",
  ...(i === 4 ? { article: "het" } : {}),
  gloss: i === 4 ? "house" : `word ${i + 1}`,
  ...(i === 4
    ? { sentence: "Het huis is groot.", translation: "The house is big.", mark: [4, 8] }
    : {}),
}));

type Ev = NativeWordAddedEvent;
function recorder() {
  const events: Ev[] = [];
  return { events, record: async (e: Ev) => void events.push(e) };
}
const notesOf = (events: Ev[]) => events.flatMap((e) => e.notes);
const cardsOf = (events: Ev[]) => events.flatMap((e) => e.cards);

describe("starter words", () => {
  it("names the levels' decks and reads them back", () => {
    expect(starterDeck(1)).toBe("Vuurtoren · Woorden 1–500");
    expect(starterDeck(6)).toBe("Vuurtoren · Woorden 2501–3000");
    expect(starterLevelOf("Vuurtoren · Woorden 4501–5000")).toBe(10);
    expect(starterLevelOf("Vuurtoren::Nederlands")).toBeNull();
    expect(
      starterLevelsHeld([{ name: starterDeck(3) }, { name: "x" }, { name: starterDeck(1) }]),
    ).toEqual([1, 3]);
  });

  it("adds a level as new cards of Vuurtoren's word type, in order of rank, decks closed", async () => {
    const { events, record } = recorder();
    const r = await addStarterWords(record, {
      lang: "nl",
      words: WORDS,
      levels: [1],
      held: new Map(),
    });
    expect(r).toEqual({ added: 500, skipped: 0, decks: [starterDeck(1)] });
    expect(events).toHaveLength(2); // 300 notes per event
    const notes = notesOf(events);
    const cards = cardsOf(events);
    expect(cards.map((c) => c.position)).toEqual(WORDS.slice(0, 500).map((w) => w.rank));
    expect(cards.every((c) => !c.schedule && c.deck === starterDeck(1))).toBe(true);
    const huis = notes.find((n) => n.key === "huis")!;
    expect(huis.notetypeId).toBe("vuurtoren-word");
    expect(huis.fields.slice(0, 4)).toEqual([
      "het huis",
      "house",
      "Het <b>huis</b> is groot.",
      "The house is big.",
    ]);
    expect(huis.article).toBe("het");
    // The audio pack's clip ids, kept on the note (sha1 of "het huis" and of the sentence).
    expect(huis.audio).toBe("word-7f3acd97cd7cde99");
    expect(huis.sentenceAudio).toMatch(/^sentence-[0-9a-f]{16}$/);
    const first = events[0] as NativeWordAddedEvent;
    expect(first.decks[0]!.options.newPerDay).toBe(0);
  });

  it("is idempotent: words already held are skipped, and ids are fixed", async () => {
    const a = recorder();
    await addStarterWords(a.record, { lang: "nl", words: WORDS, levels: [1], held: new Map() });
    const held = new Map<string, NativeCard[]>(
      cardsOf(a.events).map((c) => [notesOf(a.events).find((n) => n.id === c.noteId)!.key!, [c]]),
    );
    const b = recorder();
    const r = await addStarterWords(b.record, { lang: "nl", words: WORDS, levels: [1], held });
    expect(r).toMatchObject({ added: 0, skipped: 500 });
    expect(b.events).toEqual([]);
    const c = recorder();
    await addStarterWords(c.record, { lang: "nl", words: WORDS, levels: [1], held: new Map() });
    expect(notesOf(c.events).map((n) => n.id)).toEqual(notesOf(a.events).map((n) => n.id));
  });

  it("opens one level at a time: the lowest with new cards, when none is open", () => {
    const closed = { ...DEFAULT_DECK_OPTIONS, newPerDay: 0 };
    const decks = [
      { name: starterDeck(2), options: closed, fresh: 500 },
      { name: starterDeck(1), options: closed, fresh: 0 },
      { name: "Mine", options: DEFAULT_DECK_OPTIONS, fresh: 10 },
    ];
    expect(openStarterLevel(decks)).toEqual({
      deck: starterDeck(2),
      options: { ...closed, newPerDay: DEFAULT_DECK_OPTIONS.newPerDay },
    });
    expect(
      openStarterLevel([
        ...decks,
        { name: starterDeck(3), options: DEFAULT_DECK_OPTIONS, fresh: 5 },
      ]),
    ).toBeNull();
    expect(openStarterLevel([{ name: starterDeck(1), options: closed, fresh: 0 }])).toBeNull();
  });

  it("opens from the start level only; a new start level closes the others", () => {
    const closed = { ...DEFAULT_DECK_OPTIONS, newPerDay: 0 };
    const decks = [1, 2, 3, 4].map((l) => ({ name: starterDeck(l), options: closed, fresh: 500 }));
    expect(openStarterLevel(decks, 3)?.deck).toBe(starterDeck(3));
    const open = decks.map((d, i) => (i === 2 ? { ...d, options: DEFAULT_DECK_OPTIONS } : d));
    expect(openStarterLevel(open, 3)).toBeNull();
    // Level 3 runs out: level 4 opens, never the levels below the start.
    const done = open.map((d, i) => (i === 2 ? { ...d, fresh: 0 } : d));
    expect(openStarterLevel(done, 3)?.deck).toBe(starterDeck(4));
    expect(openStarterLevel(decks.slice(0, 2), 3)).toBeNull();
    // Turning the levels below on: level 1 opens now and level 3 closes.
    expect(startStarterFrom(open, 1)).toEqual([
      { deck: starterDeck(3), options: closed },
      { deck: starterDeck(1), options: DEFAULT_DECK_OPTIONS },
    ]);
    expect(startStarterFrom(open, 3)).toEqual([]);
  });
});

describe("starter bands", () => {
  it("names levels by the stories' CEFR bands, at the edges", () => {
    const bandOfRank = (rank: number) => starterBand(Math.ceil(rank / 500));
    expect([500, 501, 1000, 1001, 2000, 2001, 3500, 3501, 4930].map(bandOfRank)).toEqual([
      "A1",
      "A1",
      "A1",
      "A2",
      "A2",
      "B1",
      "B1",
      "B2",
      "B2",
    ]);
    expect(starterLevelName(1)).toBe("A1 · 1–500");
    expect(starterLevelName(10, 4930)).toBe("B2 · 4501–4930");
  });
});
