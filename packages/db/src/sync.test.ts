/**
 * The log between devices: export, import in clock order, merged reviews, events from a newer
 * app, compaction.
 */
import {
  DEFAULT_DECK_OPTIONS,
  DEFAULT_FSRS_PARAMS,
  type NativeNotetype,
  answerCard,
} from "@app/core";
import { describe, expect, it } from "vitest";
import { createNodeDriver } from "./node.js";
import { type KenningRepository, createRepository } from "./repository.js";
import type { AppEvent, SyncEvent } from "./types.js";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 1, 12);

async function device(id: string, start: number) {
  let t = start;
  const repo = await createRepository(await createNodeDriver(), { deviceId: id, now: () => t++ });
  return { repo, at: (ms: number) => (t = ms) };
}

/** Everything one device wrote that the other has not seen. */
async function send(from: KenningRepository, to: KenningRepository) {
  return to.importEvents(await from.exportEvents());
}

const WORD: NativeNotetype = {
  id: "kenning-word",
  name: "Kenning Word",
  kind: "standard",
  fields: ["Word", "Gloss"],
  templates: [{ name: "R", front: "{{Word}}", back: "{{Gloss}}" }],
  css: "",
  vocab: { word: "Word", gloss: "Gloss" },
};
const ctx = { options: DEFAULT_DECK_OPTIONS, params: DEFAULT_FSRS_PARAMS, fuzz: false };
const learned = answerCard(answerCard(undefined, 3, T0 - 20 * DAY, ctx), 3, T0 - 10 * DAY, ctx);
const cardAdded: AppEvent = {
  type: "NativeNotesAdded",
  lang: "nl",
  origin: "kenning",
  notetypes: [WORD],
  decks: [{ name: "Dutch", options: DEFAULT_DECK_OPTIONS }],
  notes: [{ id: 1, notetypeId: WORD.id, fields: ["huis", "house"], tags: [], key: "huis" }],
  cards: [{ id: 11, noteId: 1, ord: 0, deck: "Dutch", position: 0, schedule: learned }],
};

describe("sync between devices", () => {
  it("exports this device's events and imports them once, at the end of the log", async () => {
    const a = await device("A", T0);
    const b = await device("B", T0 + 1000);
    await a.repo.append({ type: "WordStateSet", lang: "nl", key: "fiets", state: "known" });
    const out = await a.repo.exportEvents();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ deviceId: "A", v: 1, event: { type: "WordStateSet" } });
    expect(await b.repo.importEvents(out)).toEqual({ added: 1, invalid: 0, rebuilt: false });
    expect(await b.repo.importEvents(out)).toEqual({ added: 0, invalid: 0, rebuilt: false });
    expect((await b.repo.word("nl", "fiets"))?.state).toBe("known");
    // B only exports its own events; A's are not sent back.
    expect(await b.repo.exportEvents()).toEqual([]);
    // A cursor: only what comes after.
    await a.repo.append({ type: "WordStateSet", lang: "nl", key: "huis", state: "known" });
    expect(await a.repo.exportEvents(out[0]!.id)).toHaveLength(1);
  });

  it("replays in clock order when older events arrive: the latest change wins on both", async () => {
    const a = await device("A", T0);
    const b = await device("B", T0 + 5000);
    // A marks the word earlier, B later; B's import of A's older event replays the log.
    await a.repo.append({ type: "WordStateSet", lang: "nl", key: "fiets", state: "known" });
    await b.repo.append({ type: "WordStateSet", lang: "nl", key: "fiets", state: "learning" });
    expect((await send(a.repo, b.repo)).rebuilt).toBe(true);
    expect((await send(b.repo, a.repo)).rebuilt).toBe(false);
    expect((await a.repo.word("nl", "fiets"))?.state).toBe("learning");
    expect((await b.repo.word("nl", "fiets"))?.state).toBe("learning");
    // Their clocks moved past what they received.
    await a.repo.append({ type: "WordStateSet", lang: "nl", key: "fiets", state: "unknown" });
    expect((await send(a.repo, b.repo)).rebuilt).toBe(false);
    expect((await b.repo.word("nl", "fiets"))?.state).not.toBe("learning");
  });

  it("merges answers to the same card given on two devices", async () => {
    const a = await device("A", T0);
    const b = await device("B", T0 + 1);
    await a.repo.append(cardAdded);
    await send(a.repo, b.repo);
    // Both answer the card as it was: A says Good first, B says Again later.
    const good = answerCard(learned, 3, T0 + DAY, ctx);
    a.at(T0 + DAY);
    await a.repo.append({
      type: "CardReviewed",
      lang: "nl",
      cardId: 11,
      rating: 3,
      at: T0 + DAY,
      durationMs: 1000,
      schedule: good,
      previous: learned,
    });
    b.at(T0 + DAY + 3_600_000);
    await b.repo.append({
      type: "CardReviewed",
      lang: "nl",
      cardId: 11,
      rating: 1,
      at: T0 + DAY + 3_600_000,
      durationMs: 1000,
      schedule: answerCard(learned, 1, T0 + DAY + 3_600_000, ctx),
      previous: learned,
    });
    await send(a.repo, b.repo);
    await send(b.repo, a.repo);
    const expected = answerCard(good, 1, T0 + DAY + 3_600_000, ctx);
    for (const r of [a.repo, b.repo]) {
      expect((await r.nativeCard("nl", 11))?.card.schedule).toEqual(expected);
      expect((await r.nativeReviews("nl")).map((x) => x.rating)).toEqual([3, 1]);
    }
  });

  it("keeps events of a newer app unapplied, and sends them on", async () => {
    const a = await device("A", T0);
    const future = {
      id: "01JZZZZZZZZZZZZZZZZZZZZZZZ",
      deviceId: "Z",
      hlc: `${String(T0 + 10).padStart(15, "0")}-0000-Z`,
      createdAt: T0 + 10,
      v: 1,
      event: { type: "FromTheFuture", lang: "nl" },
    } as unknown as SyncEvent;
    const newer = {
      ...future,
      id: "01JZZZZZZZZZZZZZZZZZZZZZZY",
      v: 99,
      event: { type: "WordStateSet", lang: "nl", key: "x", state: "known" },
    } as unknown as SyncEvent;
    expect(
      await a.repo.importEvents([future, newer, { bad: 1 } as unknown as SyncEvent]),
    ).toMatchObject({
      added: 2,
      invalid: 1,
    });
    // Not applied: the word stays unmarked; the events stay in the log.
    expect(await a.repo.word("nl", "x")).toBeNull();
    expect(await a.repo.eventCount()).toBe(2);
  });

  it("compacts older Anki snapshots and the contents of deleted texts, projections unchanged", async () => {
    const a = await device("A", T0);
    const snap = (state: "known" | "learning"): AppEvent => ({
      type: "AnkiSnapshotImported",
      lang: "nl",
      entries: [{ key: "huis", state, pKnown: 0.9, noteIds: [1], decks: ["Dutch"] }],
      sources: ["Dutch"],
    });
    await a.repo.append(snap("learning"));
    await a.repo.append(snap("known"));
    await a.repo.append({
      type: "TextImported",
      textId: "t1",
      title: "Weg",
      lang: "nl",
      source: { kind: "paste" },
      content: "Een lange tekst.",
    });
    await a.repo.append({ type: "TextDeleted", textId: "t1" });
    const before = await a.repo.word("nl", "huis");
    expect(await a.repo.compact()).toEqual({ removed: 1, emptied: 1 });
    expect(await a.repo.compact()).toEqual({ removed: 0, emptied: 0 });
    await a.repo.rebuild();
    expect(await a.repo.word("nl", "huis")).toEqual(before);
    expect(await a.repo.listTexts()).toEqual([]);
    const sent = await a.repo.exportEvents();
    expect(sent.map((e) => e.event.type)).toEqual([
      "AnkiSnapshotImported",
      "TextImported",
      "TextDeleted",
    ]);
    expect((sent[1]!.event as { content: string }).content).toBe("");
  });

  it("keeps per-device bookkeeping out of the log", async () => {
    const a = await device("A", T0);
    expect(await a.repo.syncState()).toBeNull();
    await a.repo.setSyncState({ out: "x" });
    expect(await a.repo.syncState()).toEqual({ out: "x" });
    expect(await a.repo.eventCount()).toBe(0);
  });
});
