import { DEFAULT_DECK_OPTIONS, type NativeCard } from "@app/core";
import { describe, expect, it } from "vitest";
import type { NativeCardsChangedEvent, NativeWordAddedEvent } from "./native.js";
import {
  type StarterWord,
  addStarterWords,
  openStarterLevel,
  starterDeck,
  starterLevelOf,
  starterLevelsHeld,
} from "./starter.js";

const NOW = Date.UTC(2026, 5, 1, 12);
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

type Ev = NativeWordAddedEvent | NativeCardsChangedEvent;
function recorder() {
  const events: Ev[] = [];
  return { events, record: async (e: Ev) => void events.push(e) };
}
const notesOf = (events: Ev[]) =>
  events.flatMap((e) => (e.type === "NativeNotesAdded" ? e.notes : []));
const cardsOf = (events: Ev[]) =>
  events.flatMap((e) => (e.type === "NativeNotesAdded" ? e.cards : []));

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
    const r = await addStarterWords(
      record,
      { lang: "nl", words: WORDS, levels: [1], held: new Map() },
      NOW,
    );
    expect(r).toEqual({ added: 500, known: 0, skipped: 0, decks: [starterDeck(1)] });
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
    const first = events[0] as NativeWordAddedEvent;
    expect(first.decks[0]!.options.newPerDay).toBe(0);
  });

  it("is idempotent: words already held are skipped, and ids are fixed", async () => {
    const a = recorder();
    await addStarterWords(
      a.record,
      { lang: "nl", words: WORDS, levels: [1], held: new Map() },
      NOW,
    );
    const held = new Map<string, NativeCard[]>(
      cardsOf(a.events).map((c) => [notesOf(a.events).find((n) => n.id === c.noteId)!.key!, [c]]),
    );
    const b = recorder();
    const r = await addStarterWords(b.record, { lang: "nl", words: WORDS, levels: [1], held }, NOW);
    expect(r).toMatchObject({ added: 0, skipped: 500 });
    expect(b.events).toEqual([]);
    const c = recorder();
    await addStarterWords(
      c.record,
      { lang: "nl", words: WORDS, levels: [1], held: new Map() },
      NOW + 5,
    );
    expect(notesOf(c.events).map((n) => n.id)).toEqual(notesOf(a.events).map((n) => n.id));
  });

  it("places: words through the rank become known, held new cards are marked, levels above are new", async () => {
    const { events, record } = recorder();
    const mine: NativeCard = { id: 42, noteId: 41, ord: 0, deck: "Mine", position: 1 };
    const r = await addStarterWords(
      record,
      {
        lang: "nl",
        words: WORDS,
        levels: [2, 3],
        knownThrough: 500,
        held: new Map([["huis", [mine]]]),
      },
      NOW,
    );
    expect(r).toMatchObject({ added: 1000, known: 500, skipped: 0 });
    const cards = cardsOf(events);
    const known = cards.filter((c) => c.schedule);
    expect(known).toHaveLength(499);
    expect(known.every((c) => c.deck === starterDeck(1) && c.schedule!.scheduledDays >= 21)).toBe(
      true,
    );
    const marked = events.find((e) => e.type === "NativeCardsChanged") as NativeCardsChangedEvent;
    expect(marked.reason).toBe("known");
    expect(marked.changes.map((c) => c.cardId)).toEqual([42]);
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
});
