import {
  DEFAULT_DECK_OPTIONS,
  DEFAULT_FSRS_PARAMS,
  type NativeNotetype,
  answerCard,
  defaultProfile,
} from "@app/core";
import { describe, expect, it } from "vitest";
import { createNodeDriver } from "./node.js";
import { createRepository } from "./repository.js";
import { validateRpcArgs } from "./rpc.js";
import type { AppEvent } from "./types.js";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 2, 1, 12);

async function newRepo(start = T0) {
  let t = start;
  const clock = { set: (v: number) => (t = v) };
  const repo = await createRepository(await createNodeDriver(), {
    deviceId: "dev1",
    now: () => t++,
  });
  return { repo, clock };
}

const WORD: NativeNotetype = {
  id: "kenning-word",
  name: "Kenning Word",
  kind: "standard",
  fields: ["Word", "Gloss", "Sentence"],
  templates: [{ name: "Recognition", front: "{{Word}}", back: "{{FrontSide}}<hr>{{Gloss}}" }],
  css: "",
  vocab: { word: "Word", gloss: "Gloss", sentence: "Sentence" },
};

const ctx = { options: DEFAULT_DECK_OPTIONS, params: DEFAULT_FSRS_PARAMS, fuzz: false };
const mature = answerCard(answerCard(undefined, 4, T0 - 90 * DAY, ctx), 4, T0 - 40 * DAY, ctx);

/** Two imported notes (one mature, one new) and their history. */
const imported: AppEvent = {
  type: "NativeNotesAdded",
  lang: "nl",
  origin: "apkg",
  notetypes: [WORD],
  decks: [{ name: "Dutch", options: { ...DEFAULT_DECK_OPTIONS, newPerDay: 1 } }],
  notes: [
    {
      id: 11,
      notetypeId: WORD.id,
      fields: ["huis", "house", ""],
      tags: [],
      key: "huis",
      gloss: "house",
    },
    { id: 12, notetypeId: WORD.id, fields: ["fiets", "bike", ""], tags: [], key: "fiets" },
    { id: 13, notetypeId: WORD.id, fields: ["boom", "tree", ""], tags: [], key: "boom" },
  ],
  cards: [
    { id: 101, noteId: 11, ord: 0, deck: "Dutch", schedule: mature, position: 0 },
    { id: 102, noteId: 12, ord: 0, deck: "Dutch", position: 1 },
    { id: 103, noteId: 13, ord: 0, deck: "Dutch", position: 2 },
  ],
  reviews: [
    { cardId: 101, at: T0 - 90 * DAY, rating: 4, kind: "learn", durationMs: 3000 },
    { cardId: 101, at: T0 - 40 * DAY, rating: 4, kind: "review", durationMs: 2000 },
  ],
  media: { "huis.jpg": "a".repeat(64) },
};

describe("native card store", () => {
  it("imports notes, cards, history and media; a second import keeps progress", async () => {
    const { repo } = await newRepo();
    await repo.append(imported);
    expect(await repo.nativeStats("nl")).toEqual({ notes: 3, cards: 3, reviews: 2 });
    expect(await repo.nativeMedia("nl", ["huis.jpg", "x.mp3"])).toEqual({
      "huis.jpg": "a".repeat(64),
    });
    const [deck] = await repo.nativeDecks("nl", T0);
    expect(deck).toMatchObject({ name: "Dutch", total: 3, fresh: 2, due: 0 });
    await repo.append(imported);
    expect(await repo.nativeStats("nl")).toEqual({ notes: 3, cards: 3, reviews: 2 });
  });

  it("queues due cards, then new cards within the daily limit; undo restores", async () => {
    const { repo } = await newRepo();
    await repo.append(imported);
    const q = await repo.nativeQueue("nl", T0, T0 - 3600_000, 50);
    expect(q.cards.map((c) => c.card.id)).toEqual([102]);
    expect(q.fresh).toBe(1);
    const view = q.cards[0]!;
    expect(view.notetype.id).toBe("kenning-word");
    const schedule = answerCard(undefined, 3, T0, ctx);
    const stored = await repo.append({
      type: "CardReviewed",
      lang: "nl",
      cardId: 102,
      rating: 3,
      at: T0,
      durationMs: 4000,
      schedule,
    });
    // The daily limit of one new card is used up; the learning card is due in 10 minutes.
    expect(
      (await repo.nativeQueue("nl", T0 + 1000, T0 - 3600_000, 50)).cards.map((c) => c.card.id),
    ).toEqual([102]);
    expect((await repo.nativeQueue("nl", T0 + 1000, T0 - 3600_000, 50)).fresh).toBe(0);
    expect((await repo.nativeReviews("nl")).length).toBe(3);
    await repo.append({ type: "CardReviewUndone", lang: "nl", cardId: 102, reviewId: stored.id });
    expect((await repo.nativeCard("nl", 102))?.card.schedule).toBeUndefined();
    expect((await repo.nativeReviews("nl")).length).toBe(2);
  });

  it("feeds the learner model in native mode only", async () => {
    const { repo } = await newRepo();
    await repo.append(imported);
    await repo.append({
      type: "AnkiSnapshotImported",
      lang: "nl",
      sources: ["Old"],
      entries: [{ key: "kat", state: "known", pKnown: 0.9, noteIds: [1], decks: ["Old"] }],
    });
    // No profile, or a connected one: Anki is the record.
    expect([...(await repo.learnerModel("nl")).keys()]).toEqual(["kat"]);
    await repo.append({ type: "LanguageProfileSet", profile: defaultProfile("nl") });
    const model = await repo.learnerModel("nl");
    expect(model.get("huis")?.state).toBe("known");
    expect(model.get("fiets")).toEqual({ state: "unknown", pKnown: 0 });
    expect(model.has("kat")).toBe(false);
    const huis = await repo.word("nl", "huis");
    expect(huis).toMatchObject({ source: "anki", gloss: "house", noteIds: [11], decks: ["Dutch"] });
    const status = await repo.nativeNoteStatus("nl", [11, 12], T0);
    expect(status.map((s) => s.cards[0]?.type)).toEqual(["review", "new"]);
  });

  it("a word added in Kenning is learning until its first answer", async () => {
    const { repo } = await newRepo();
    await repo.append({ type: "LanguageProfileSet", profile: defaultProfile("nl") });
    await repo.append({
      type: "NativeNotesAdded",
      lang: "nl",
      origin: "kenning",
      notetypes: [WORD],
      decks: [{ name: "Kenning::Nederlands", options: DEFAULT_DECK_OPTIONS }],
      notes: [{ id: 5, notetypeId: WORD.id, fields: ["de kat", "", ""], tags: [], key: "kat" }],
      cards: [{ id: 6, noteId: 5, ord: 0, deck: "Kenning::Nederlands", position: 0 }],
    });
    expect(await repo.word("nl", "kat")).toMatchObject({
      state: "learning",
      pKnown: 0.2,
      addedNoteId: 5,
    });
  });

  it("rebuilds to the same tables", async () => {
    const { repo } = await newRepo();
    await repo.append({ type: "LanguageProfileSet", profile: defaultProfile("nl") });
    await repo.append(imported);
    await repo.append({
      type: "CardReviewed",
      lang: "nl",
      cardId: 102,
      rating: 3,
      at: T0,
      durationMs: 1,
      schedule: answerCard(undefined, 3, T0, ctx),
    });
    await repo.append({
      type: "NativeCardsChanged",
      lang: "nl",
      reason: "first",
      changes: [{ cardId: 103, position: -5, suspended: true }],
    });
    await repo.append({
      type: "NativeDeckOptionsSet",
      lang: "nl",
      deck: "Dutch",
      options: { ...DEFAULT_DECK_OPTIONS, desiredRetention: 0.85 },
    });
    await repo.append({
      type: "FsrsParamsSet",
      lang: "nl",
      params: [...DEFAULT_FSRS_PARAMS],
      reviews: 3,
      logLoss: 0.3,
    });
    const snapshot = async () => ({
      decks: await repo.nativeDecks("nl", T0 + DAY),
      queue: await repo.nativeQueue("nl", T0 + DAY, T0 + DAY / 2, 50),
      reviews: await repo.nativeReviews("nl"),
      params: await repo.fsrsParams("nl"),
      model: [...(await repo.learnerModel("nl"))].map(([k, v]) => [k, v.state]),
    });
    const before = await snapshot();
    expect(before.decks[0]?.options.desiredRetention).toBe(0.85);
    expect(before.params?.logLoss).toBe(0.3);
    await repo.rebuild();
    expect(await snapshot()).toEqual(before);
  });

  it("allows the native queries over RPC", () => {
    expect(validateRpcArgs("nativeQueue", ["nl", 1, 0, 20])).toBeNull();
    expect(validateRpcArgs("nativeNoteStatus", ["nl", [1, 2], 0])).toBeNull();
    expect(validateRpcArgs("nativeNoteStatus", ["nl", ["1"], 0])).toMatch(/numbers/);
    expect(validateRpcArgs("append", [imported])).toBeNull();
  });

  it("keeps related cards apart: one card of a note or word a day; learning steps go on", async () => {
    const { repo, clock } = await newRepo();
    const due = (d: number) => ({ ...mature, due: T0 - d * DAY, state: 2 as const });
    await repo.append({
      type: "NativeNotesAdded",
      lang: "nl",
      origin: "apkg",
      notetypes: [WORD],
      decks: [{ name: "Dutch", options: DEFAULT_DECK_OPTIONS }],
      notes: [
        { id: 21, notetypeId: WORD.id, fields: ["kat", "cat", ""], tags: [], key: "kat" },
        { id: 22, notetypeId: WORD.id, fields: ["de kat", "cat", ""], tags: [], key: "kat" },
        { id: 23, notetypeId: WORD.id, fields: ["hond", "dog", ""], tags: [], key: "hond" },
      ],
      cards: [
        // Two cards of one note, a card of another note of the same word, another word.
        { id: 201, noteId: 21, ord: 0, deck: "Dutch", schedule: due(3), position: 0 },
        { id: 202, noteId: 21, ord: 1, deck: "Dutch", schedule: due(2), position: 1 },
        { id: 203, noteId: 22, ord: 0, deck: "Dutch", schedule: due(1), position: 2 },
        { id: 204, noteId: 23, ord: 0, deck: "Dutch", schedule: due(1), position: 3 },
      ],
    });
    const start = T0 - 6 * 3_600_000;
    let q = await repo.nativeQueue("nl", T0, start, 10);
    expect(q.cards.map((c) => c.card.id)).toEqual([201, 204]);
    expect(q.due).toBe(2);
    clock.set(T0);
    const relearn = answerCard(due(3), 1, T0, ctx);
    await repo.append({
      type: "CardReviewed",
      lang: "nl",
      cardId: 201,
      rating: 1,
      at: T0,
      durationMs: 1000,
      schedule: relearn,
      previous: due(3),
    });
    // 202 and 203 wait for tomorrow; 201 relearns (due again in its step).
    q = await repo.nativeQueue("nl", T0 + 3_600_000, start, 10);
    expect(q.cards.map((c) => c.card.id)).toEqual([204, 201]);
    q = await repo.nativeQueue("nl", T0 + DAY, start + DAY, 10);
    expect(q.cards.map((c) => c.card.id)).toContain(202);
  });

  it("counts reviews due on each coming study day", async () => {
    const { repo } = await newRepo();
    await repo.append(imported);
    const dueDay = Math.floor((mature.due - T0) / DAY);
    const counts = await repo.nativeDueCounts("nl", T0, dueDay + 2);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
    expect(counts[dueDay]).toBe(1);
    expect(validateRpcArgs("nativeDueCounts", ["nl", T0, 30])).toBeNull();
  });
});
