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
  id: "vuurtoren-word",
  name: "Vuurtoren Word",
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
    expect(view.notetype.id).toBe("vuurtoren-word");
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

  it("a word added in Vuurtoren is learning until its first answer", async () => {
    const { repo } = await newRepo();
    await repo.append({ type: "LanguageProfileSet", profile: defaultProfile("nl") });
    await repo.append({
      type: "NativeNotesAdded",
      lang: "nl",
      origin: "vuurtoren",
      notetypes: [WORD],
      decks: [{ name: "Vuurtoren::Nederlands", options: DEFAULT_DECK_OPTIONS }],
      notes: [{ id: 5, notetypeId: WORD.id, fields: ["de kat", "", ""], tags: [], key: "kat" }],
      cards: [{ id: 6, noteId: 5, ord: 0, deck: "Vuurtoren::Nederlands", position: 0 }],
    });
    expect(await repo.word("nl", "kat")).toMatchObject({
      state: "learning",
      pKnown: 0.2,
      addedNoteId: 5,
    });
  });

  it("a starter word not met yet is not counted as being learned", async () => {
    const { repo } = await newRepo();
    await repo.append({ type: "LanguageProfileSet", profile: defaultProfile("nl") });
    await repo.append({
      type: "NativeNotesAdded",
      lang: "nl",
      origin: "vuurtoren",
      notetypes: [WORD],
      decks: [{ name: "Vuurtoren::Woorden 1–500", options: DEFAULT_DECK_OPTIONS }],
      notes: [
        {
          id: 5,
          notetypeId: WORD.id,
          fields: ["de kat", "", ""],
          tags: ["vuurtoren", "vuurtoren::starter"],
          key: "kat",
        },
      ],
      cards: [{ id: 6, noteId: 5, ord: 0, deck: "Vuurtoren::Woorden 1–500", position: 1 }],
    });
    const kat = await repo.word("nl", "kat");
    expect(kat).toMatchObject({ state: "unknown", pKnown: 0, noteIds: [5] });
  });

  it("without a profile (setup skipped) a word added in Vuurtoren has its card", async () => {
    const { repo } = await newRepo();
    await repo.append({
      type: "NativeNotesAdded",
      lang: "nl",
      origin: "vuurtoren",
      notetypes: [WORD],
      decks: [{ name: "Vuurtoren::Nederlands", options: DEFAULT_DECK_OPTIONS }],
      notes: [{ id: 5, notetypeId: WORD.id, fields: ["de kat", "", ""], tags: [], key: "kat" }],
      cards: [{ id: 6, noteId: 5, ord: 0, deck: "Vuurtoren::Nederlands", position: 0 }],
    });
    expect(await repo.word("nl", "kat")).toMatchObject({
      state: "learning",
      noteIds: [5],
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
    // The badge's count-only query follows the same rules (limits, related cards apart).
    for (const [at, from] of [
      [T0, start],
      [T0 + 3_600_000, start],
      [T0 + DAY, start + DAY],
    ] as const) {
      const full = await repo.nativeQueue("nl", at, from, 10);
      expect(await repo.nativeQueueCounts("nl", at, from)).toEqual({
        due: full.due,
        fresh: full.fresh,
        nextDue: full.nextDue,
      });
    }
    // The relearning card answered at T0 is the next to come due, within the hour.
    const soon = await repo.nativeQueueCounts("nl", T0 + 1, start);
    expect(soon.nextDue).toBe(relearn.due);
  });

  it("counts reviews due on each coming study day", async () => {
    const { repo } = await newRepo();
    await repo.append(imported);
    const dueDay = Math.floor((mature.due - T0) / DAY);
    const counts = await repo.nativeDueCounts("nl", T0, dueDay + 2);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
    expect(counts[dueDay]).toBe(1);
  });

  it("lists due words, a card's history and the last answer to undo; reviews count as activity", async () => {
    const { repo, clock } = await newRepo();
    await repo.append(imported);
    // huis (card 101) is due once its interval has passed.
    const later = mature.due + DAY;
    expect(await repo.nativeDueKeys("nl", T0, 10)).toEqual([]);
    expect(await repo.nativeDueKeys("nl", later, 10)).toEqual([{ key: "huis", due: mature.due }]);
    expect(await repo.nativeLastReview("nl")).toBeNull();

    clock.set(later);
    const next = answerCard(mature, 3, later, ctx);
    const stored = await repo.append({
      type: "CardReviewed",
      lang: "nl",
      cardId: 101,
      rating: 3,
      at: later,
      durationMs: 1000,
      schedule: next,
      previous: mature,
    });
    expect((await repo.nativeCardReviews("nl", [101])).map((r) => r.rating)).toEqual([4, 4, 3]);
    expect(await repo.nativeCardReviews("nl", [])).toEqual([]);
    expect(await repo.nativeLastReview("nl")).toEqual({
      cardId: 101,
      reviewId: stored.id,
      at: later,
    });
    expect((await repo.activity(later - DAY)).filter((a) => a.kind === "review")).toHaveLength(1);

    await repo.append({ type: "CardReviewUndone", lang: "nl", cardId: 101, reviewId: stored.id });
    expect(await repo.nativeLastReview("nl")).toBeNull();
    expect((await repo.activity(later - DAY)).filter((a) => a.kind === "review")).toHaveLength(0);
  });
});

describe("native cards on two devices", () => {
  /** A device whose clock the test sets (each event one millisecond later). */
  async function device(id: string, start: number) {
    let t = start;
    const repo = await createRepository(await createNodeDriver(), {
      deviceId: id,
      now: () => t++,
    });
    return { repo, at: (ms: number) => (t = ms) };
  }
  type Device = Awaited<ReturnType<typeof device>>;

  /** Each device receives what the other wrote. */
  async function exchange(a: Device, b: Device) {
    await b.repo.importEvents(await a.repo.exportEvents());
    await a.repo.importEvents(await b.repo.exportEvents());
  }

  // Card 101 is a review card due a day ago; 102 a review card due in ten days.
  const due = { ...mature, due: T0 - DAY };
  const notYet = { ...mature, due: T0 + 10 * DAY };
  const cards: AppEvent = {
    ...(imported as Extract<AppEvent, { type: "NativeNotesAdded" }>),
    cards: [
      { id: 101, noteId: 11, ord: 0, deck: "Dutch", schedule: due, position: 0 },
      { id: 102, noteId: 12, ord: 0, deck: "Dutch", schedule: notYet, position: 1 },
    ],
    reviews: [],
  };

  async function pair() {
    const a = await device("A", T0);
    const b = await device("B", T0 + 1);
    await a.repo.append(cards);
    await exchange(a, b);
    return { a, b };
  }

  const schedule = async (d: Device, id: number) =>
    (await d.repo.nativeCard("nl", id))?.card.schedule;

  /** Answer a card on one device, from the card as that device sees it. */
  async function answer(d: Device, cardId: number, rating: 1 | 2 | 3 | 4, at: number) {
    d.at(at);
    const previous = await schedule(d, cardId);
    return d.repo.append({
      type: "CardReviewed",
      lang: "nl",
      cardId,
      rating,
      at,
      durationMs: 1000,
      schedule: answerCard(previous, rating, at, ctx),
      ...(previous ? { previous } : {}),
    });
  }

  async function expectSame(a: Device, b: Device) {
    for (const id of [101, 102]) expect(await schedule(a, id)).toEqual(await schedule(b, id));
    expect(await a.repo.nativeReviews("nl")).toEqual(await b.repo.nativeReviews("nl"));
  }

  const reading = (cardId: number, to: "later" | "now", at: number, days = 3) => ({
    cardId,
    due: { to, at, days, dayEnd: T0 + DAY, lastReview: mature.lastReview },
  });

  it("keeps an answer from one device when the other reads the word later", async () => {
    expect(mature.state).toBe(2);
    const { a, b } = await pair();
    // B answers both cards; A, not synced yet, then finishes a page with the due word (it
    // moves later) and looks up the other word (it becomes due now).
    await answer(b, 101, 3, T0 + 1000);
    await answer(b, 102, 3, T0 + 1000);
    const answered = [await schedule(b, 101), await schedule(b, 102)];
    a.at(T0 + 5000);
    await a.repo.append({
      type: "NativeCardsChanged",
      lang: "nl",
      reason: "reading",
      changes: [reading(101, "later", T0 + 5000), reading(102, "now", T0 + 5000, 0)],
    });
    expect((await schedule(a, 101))?.due).toBe(T0 + 5000 + 3 * DAY);
    expect((await schedule(a, 102))?.due).toBe(T0 + 5000);
    await exchange(a, b);
    await expectSame(a, b);
    // The answers stand; the reading made way.
    expect([await schedule(a, 101), await schedule(a, 102)]).toEqual(answered);
  });

  it("counts reading on one device and a later answer on the other", async () => {
    const { a, b } = await pair();
    a.at(T0 + 1000);
    await a.repo.append({
      type: "NativeCardsChanged",
      lang: "nl",
      reason: "reading",
      changes: [reading(101, "later", T0 + 1000)],
    });
    await answer(b, 101, 1, T0 + 5000);
    await exchange(a, b);
    await expectSame(a, b);
    expect((await schedule(a, 101))?.lastReview).toBe(T0 + 5000);
    expect((await a.repo.nativeReviews("nl")).map((r) => r.rating)).toEqual([1]);
  });

  it("moves a card for reading only once when both devices read it", async () => {
    const { a, b } = await pair();
    a.at(T0 + 1000);
    await a.repo.append({
      type: "NativeCardsChanged",
      lang: "nl",
      reason: "reading",
      changes: [reading(101, "later", T0 + 1000, 2)],
    });
    b.at(T0 + 2000);
    await b.repo.append({
      type: "NativeCardsChanged",
      lang: "nl",
      reason: "reading",
      changes: [reading(101, "later", T0 + 2000, 3)],
    });
    await exchange(a, b);
    await expectSame(a, b);
    // A's move came first; B's found the card no longer due today.
    expect((await schedule(a, 101))?.due).toBe(T0 + 1000 + 2 * DAY);
  });

  it("new memory after tuning keeps an answer from the other device", async () => {
    const { a, b } = await pair();
    const tuned = DEFAULT_FSRS_PARAMS.map((w, i) => (i === 0 ? w * 2 : w));
    await answer(b, 101, 3, T0 + 1000);
    const answered = await schedule(b, 101);
    a.at(T0 + 5000);
    await a.repo.append({ type: "FsrsParamsSet", lang: "nl", params: tuned, reviews: 400 });
    await a.repo.append({
      type: "NativeCardsChanged",
      lang: "nl",
      reason: "memory",
      params: tuned,
      changes: [
        { cardId: 101, memory: { stability: 50, difficulty: 4, lastReview: mature.lastReview } },
        { cardId: 102, memory: { stability: 60, difficulty: 3, lastReview: mature.lastReview } },
      ],
    });
    await exchange(a, b);
    await expectSame(a, b);
    // The answered card keeps its answer; the other gets the new memory, due date unchanged.
    expect(await schedule(a, 101)).toEqual(answered);
    expect(await schedule(a, 102)).toEqual({ ...notYet, stability: 60, difficulty: 3 });
  });

  it("two devices tuning: cards keep the memory of the parameters in use", async () => {
    const { a, b } = await pair();
    const pa = DEFAULT_FSRS_PARAMS.map((w, i) => (i === 0 ? w * 2 : w));
    const pb = DEFAULT_FSRS_PARAMS.map((w, i) => (i === 0 ? w * 3 : w));
    const tune = async (
      d: Device,
      at: number,
      params: number[],
      stability: number,
      then: number,
    ) => {
      d.at(at);
      await d.repo.append({ type: "FsrsParamsSet", lang: "nl", params, reviews: 400 });
      d.at(at + then);
      await d.repo.append({
        type: "NativeCardsChanged",
        lang: "nl",
        reason: "memory",
        params,
        changes: [
          { cardId: 102, memory: { stability, difficulty: 5, lastReview: mature.lastReview } },
        ],
      });
    };
    // B's parameters come last; A's memory update comes after them and is left out.
    await tune(a, T0 + 1000, pa, 11, 5000);
    await tune(b, T0 + 2000, pb, 22, 500);
    await exchange(a, b);
    await expectSame(a, b);
    expect((await a.repo.fsrsParams("nl"))?.params).toEqual(pb);
    expect((await schedule(a, 102))?.stability).toBe(22);
  });

  it("an undo on one device keeps a later answer from the other", async () => {
    const { a, b } = await pair();
    const first = await answer(a, 101, 1, T0 + 1000);
    await exchange(a, b);
    // B answers the card again; A, before syncing, takes its own answer back.
    await answer(b, 101, 3, T0 + 2000);
    a.at(T0 + 3000);
    expect(await a.repo.nativeLastReview("nl")).toMatchObject({ reviewId: first.id });
    await a.repo.append({ type: "CardReviewUndone", lang: "nl", cardId: 101, reviewId: first.id });
    expect(await schedule(a, 101)).toEqual(due);
    await exchange(a, b);
    await expectSame(a, b);
    // A's answer is gone; B's counts, replayed on the card as it was before A's.
    expect((await a.repo.nativeReviews("nl")).map((r) => r.rating)).toEqual([3]);
    expect(await schedule(a, 101)).toEqual(answerCard(due, 3, T0 + 2000, ctx));
  });

  it("offers to undo only this device's own answer, while it is its card's latest", async () => {
    const { a, b } = await pair();
    const own = await answer(a, 101, 3, T0 + 1000);
    await exchange(a, b);
    // B did not give that answer: nothing to take back there.
    expect(await b.repo.nativeLastReview("nl")).toBeNull();
    expect(await a.repo.nativeLastReview("nl")).toMatchObject({ reviewId: own.id });
    // Once B answers the same card after it, A no longer offers it.
    await answer(b, 101, 1, T0 + 2000);
    await exchange(a, b);
    expect(await a.repo.nativeLastReview("nl")).toBeNull();
    expect(await b.repo.nativeLastReview("nl")).toMatchObject({ cardId: 101 });
  });

  it("still applies whole schedules written by earlier versions", async () => {
    const { b } = await pair();
    const moved = { ...due, due: T0 + 4 * DAY };
    await b.repo.importEvents([
      {
        id: "01JZZZZZZZZZZZZZZZZZZZZZZZ",
        deviceId: "OLD",
        hlc: `${String(T0 + 1000).padStart(15, "0")}-00000-OLD`,
        createdAt: T0 + 1000,
        v: 1,
        event: {
          type: "NativeCardsChanged",
          lang: "nl",
          reason: "reading",
          changes: [{ cardId: 101, schedule: moved }],
        },
      },
    ]);
    expect(await schedule(b, 101)).toEqual(moved);
  });
});
