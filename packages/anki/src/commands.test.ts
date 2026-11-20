import { defaultProfile } from "@app/core";
import { describe, expect, it } from "vitest";
import { AnkiConnectClient } from "./client.js";
import {
  type WordCommandEvent,
  markWordKnown,
  resetToAnkiState,
  setAppWordState,
  studyWordFirst,
  studyWordsFirst,
} from "./commands.js";
import { type FakeCard, fakeAnkiWrite, fakeCollection } from "./fake-anki-write.test-util.js";

const card = (o: Partial<FakeCard> & { id: number; note: number }): FakeCard => ({
  deck: "NL",
  type: 0,
  queue: 0,
  interval: 0,
  due: 100,
  ...o,
});

function setup(cards: FakeCard[]) {
  const col = fakeCollection(cards);
  const anki = new AnkiConnectClient({ fetch: fakeAnkiWrite(col) });
  const events: WordCommandEvent[] = [];
  const record = async (e: WordCommandEvent) => void events.push(e);
  return { col, anki, events, record };
}

describe("word commands", () => {
  it("study first: one word, recorded with the normalised key", async () => {
    const { anki, events, record } = setup([card({ id: 11, note: 1 })]);
    await studyWordFirst(anki, record, { lang: "nl", key: "Fiets", noteId: 1, cardIds: [11] });
    expect(events).toEqual([
      {
        type: "CardsPrioritized",
        lang: "nl",
        key: "fiets",
        noteId: 1,
        cardIds: [11],
        unsuspended: [],
      },
    ]);
    await expect(
      studyWordFirst(anki, record, {
        lang: "nl",
        key: "x",
        noteId: 2,
        cardIds: [],
      }),
    ).rejects.toThrow(/no longer new/);
  });

  it("study first: several words in order, skipping words without new cards", async () => {
    const { anki, events, record, col } = setup([
      card({ id: 21, note: 2 }),
      card({ id: 31, note: 3, type: 2, queue: 2, interval: 30 }),
      card({ id: 41, note: 4, queue: -1 }),
    ]);
    const { moved } = await studyWordsFirst(anki, record, "nl", [
      { key: "b", noteIds: [4] },
      { key: "c", noteIds: [3] },
      { key: "a", noteIds: [2] },
    ]);
    expect(moved).toBe(2);
    expect(events.map((e) => e.key)).toEqual(["b", "a"]);
    expect(events[0]).toMatchObject({ unsuspended: [41] });
    const reposition = col.log.find((l) => l.action === "scheduling.repositionNewCards");
    expect((reposition?.params as { cardIds: string[] }).cardIds).toEqual(["41", "21"]);
  });

  it("mark known: existing cards, or add the word first", async () => {
    const { anki, events, record, col } = setup([card({ id: 51, note: 5 })]);
    expect(
      await markWordKnown(anki, record, { lang: "nl", key: "Kat", noteIds: [5], cardIds: [51] }),
    ).toEqual({ key: "kat" });
    expect(col.tags.get(5)?.has("vuurtoren::known")).toBe(true);
    const r = await markWordKnown(anki, record, {
      lang: "nl",
      key: "huis",
      noteIds: [],
      cardIds: [],
      add: { profile: defaultProfile("nl"), context: { source: "reading" }, word: "het huis" },
    });
    expect(r.addedToDeck).toBeTruthy();
    expect(events.map((e) => [e.type, e.key])).toEqual([
      ["MarkedKnownInAnki", "kat"],
      ["NoteAddedToAnki", "huis"],
      ["MarkedKnownInAnki", "huis"],
    ]);
    await expect(
      markWordKnown(anki, record, { lang: "nl", key: "x", noteIds: [], cardIds: [] }),
    ).rejects.toThrow(/not in Anki/);
  });

  it("app-only states never touch Anki", async () => {
    const { events, record, col } = setup([]);
    await setAppWordState(record, "nl", " Boom ", "ignored");
    await resetToAnkiState(record, "nl", "Boom");
    expect(events).toEqual([
      { type: "WordStateSet", lang: "nl", key: "boom", state: "ignored" },
      { type: "WordStateCleared", lang: "nl", key: "boom" },
    ]);
    expect(col.log).toEqual([]);
  });
});
