import { describe, expect, it } from "vitest";
import {
  KNOWN_DUE_DATE,
  TAG_KNOWN,
  TAG_READING,
  addNoteAsKnown,
  cardStatus,
  learnNext,
  markKnownInAnki,
} from "./actions.js";
import { AnkiConnectClient } from "./client.js";
import {
  type FakeCard,
  type FakeOptions,
  fakeAnkiWrite,
  fakeCollection,
} from "./fake-anki-write.test-util.js";

const card = (o: Partial<FakeCard> & { id: number; note: number }): FakeCard => ({
  deck: "Freq",
  type: 0,
  queue: 0,
  interval: 0,
  due: 500,
  ...o,
});

function setup(cards: FakeCard[], opts: FakeOptions = {}) {
  const col = fakeCollection(cards);
  const anki = new AnkiConnectClient({ fetch: fakeAnkiWrite(col, opts) });
  const calls = (name: string) => col.log.filter((l) => l.action === name);
  return { col, anki, calls };
}

describe("cardStatus", () => {
  it("reports type, suspension, deck and due text per note", async () => {
    const { anki } = setup([
      card({ id: 11, note: 1 }),
      card({ id: 21, note: 2, type: 2, queue: 2, interval: 30, due: 6 }),
      card({ id: 31, note: 3, queue: -1, deck: "Opmaat" }),
      card({ id: 41, note: 4, type: 2, queue: 2, interval: 90, due: 200 }),
    ]);
    const { notes } = await cardStatus(anki, [1, 2, 3, 4, 99]);
    expect(notes.map((n) => n.noteId)).toEqual([1, 2, 3, 4]);
    expect(notes[0]).toEqual({
      noteId: 1,
      deck: "Freq",
      cards: [{ cardId: 11, type: "new", suspended: false, buried: false, intervalDays: 0 }],
    });
    expect(notes[1]?.cards[0]).toMatchObject({
      type: "review",
      intervalDays: 30,
      dueText: "due in 6 days",
    });
    expect(notes[2]).toMatchObject({ deck: "Opmaat" });
    expect(notes[2]?.cards[0]).toMatchObject({ type: "new", suspended: true });
    expect(notes[3]?.cards[0]?.dueText).toBe("due in more than three months");
  });

  it("works without due text when the search probe fails", async () => {
    const { anki } = setup([card({ id: 21, note: 2, type: 2, queue: 2, interval: 30, due: 6 })], {
      failing: { multi: "boom" },
    });
    const { notes } = await cardStatus(anki, [2]);
    expect(notes[0]?.cards[0]?.type).toBe("review");
    expect(notes[0]?.cards[0]?.dueText).toBeUndefined();
  });

  it("makes no request for no notes", async () => {
    const { anki, col } = setup([]);
    expect(await cardStatus(anki, [])).toEqual({ notes: [] });
    expect(col.log).toEqual([]);
  });
});

describe("learnNext", () => {
  it("repositions only new cards with the v1 shape and tags the note", async () => {
    const { anki, col, calls } = setup([
      card({ id: 11, note: 1, due: 2950 }),
      card({ id: 12, note: 1, type: 2, queue: 2, interval: 5, due: 3 }),
    ]);
    const res = await learnNext(anki, [11, 12]);
    expect(res).toEqual({ repositioned: [11], unsuspended: [] });
    expect(calls("scheduling.repositionNewCards")[0]?.params).toEqual({
      cardIds: ["11"],
      startingFrom: 0,
      stepSize: 1,
      randomize: false,
      shiftExisting: false,
    });
    expect(calls("addTags")[0]?.params).toEqual({ notes: [1], tags: TAG_READING });
    expect(calls("unsuspend")).toHaveLength(0);
    expect(col.cards.find((c) => c.id === 11)?.due).toBe(0);
    expect(col.cards.find((c) => c.id === 12)?.due).toBe(3);
  });

  it("unsuspends suspended new cards before repositioning", async () => {
    const { anki, col } = setup([card({ id: 11, note: 1, queue: -1 })]);
    const res = await learnNext(anki, [11]);
    expect(res.unsuspended).toEqual([11]);
    expect(col.log.map((l) => l.action).filter((a) => a !== "cardsInfo")).toEqual([
      "api.describe",
      "addTags",
      "unsuspend",
      "scheduling.repositionNewCards",
    ]);
    expect(col.cards[0]?.queue).toBe(0);
  });

  it("does nothing when no card is new", async () => {
    const { anki, col } = setup([card({ id: 11, note: 1, type: 2, queue: 2, interval: 40 })]);
    expect(await learnNext(anki, [11])).toEqual({ repositioned: [], unsuspended: [] });
    expect(col.log.map((l) => l.action)).toEqual(["cardsInfo"]);
  });

  it("explains that API v1 is needed and writes nothing", async () => {
    const { anki, col } = setup([card({ id: 11, note: 1 })], { v1: false });
    await expect(learnNext(anki, [11])).rejects.toThrow(
      "Learn next needs AnkiConnect with API v1 (Anki ≥ 26.08)",
    );
    expect(col.log.some((l) => l.action === "addTags")).toBe(false);
  });

  it("surfaces Anki's own error message", async () => {
    const { anki } = setup([card({ id: 11, note: 1 })], {
      failing: { "scheduling.repositionNewCards": "card is in a filtered deck" },
    });
    await expect(learnNext(anki, [11])).rejects.toThrow(/filtered deck/);
  });
});

describe("markKnownInAnki", () => {
  it("sets a 21-35 day interval, unsuspends and tags, for any card state", async () => {
    const { anki, col, calls } = setup([
      card({ id: 11, note: 1 }),
      card({ id: 21, note: 2, type: 2, queue: -1, interval: 4, due: 2 }),
    ]);
    const res = await markKnownInAnki(anki, [11, 21]);
    expect(res).toEqual({ updated: [11, 21] });
    expect(calls("setDueDate")[0]?.params).toEqual({ cards: [11, 21], days: KNOWN_DUE_DATE });
    expect(KNOWN_DUE_DATE).toBe("21-35!");
    expect(calls("unsuspend")[0]?.params).toEqual({ cards: [21] });
    expect(calls("addTags")[0]?.params).toEqual({ notes: [1, 2], tags: TAG_KNOWN });
    expect(col.cards.map((c) => [c.type, c.queue, c.interval >= 21])).toEqual([
      [2, 2, true],
      [2, 2, true],
    ]);
  });

  it("does not touch Anki for no cards", async () => {
    const { anki, col } = setup([]);
    expect(await markKnownInAnki(anki, [])).toEqual({ updated: [] });
    expect(col.log.some((l) => l.action === "setDueDate")).toBe(false);
  });
});

describe("addNoteAsKnown", () => {
  it("adds the note then marks its card known", async () => {
    const { anki, col } = setup([]);
    const res = await addNoteAsKnown(anki, { deck: "Kenning::Nederlands", word: "fiets" });
    expect(res.cardIds).toHaveLength(1);
    const c = col.cards.find((x) => x.id === res.cardIds[0]);
    expect(c).toMatchObject({ type: 2, queue: 2 });
    expect(c!.interval).toBeGreaterThanOrEqual(21);
    expect(col.tags.get(res.noteId)).toContain(TAG_KNOWN);
    expect(col.tags.get(res.noteId)).toContain("kenning");
  });

  it("reuses an existing duplicate note", async () => {
    const { anki, col } = setup([]);
    const first = await addNoteAsKnown(anki, { deck: "D", word: "fiets" });
    const second = await addNoteAsKnown(anki, { deck: "D", word: "fiets" });
    expect(second.noteId).toBe(first.noteId);
    expect(col.notes.size).toBe(1);
  });
});
