import { describe, expect, it } from "vitest";
import type { CardInfo } from "./client.js";
import { cardMemory, noteMemory } from "./memory.js";

const card = (p: Partial<CardInfo>): CardInfo => ({
  cardId: 1,
  note: 1,
  deckName: "d",
  modelName: "m",
  interval: 0,
  type: 2,
  queue: 2,
  reps: 1,
  lapses: 0,
  ...p,
});

describe("cardMemory", () => {
  it("maps new, learning and review cards", () => {
    expect(cardMemory(card({ type: 0 }))).toEqual({ intervalDays: 0, isNew: true });
    expect(cardMemory(card({ type: 1, interval: -600 })).intervalDays).toBeCloseTo(600 / 86400);
    expect(cardMemory(card({ interval: 30 }))).toEqual({ intervalDays: 30 });
    expect(cardMemory(card({ type: 1, interval: 0 })).intervalDays).toBe(0.01);
  });

  it("attaches last review time and FSRS stability", () => {
    const m = cardMemory(card({ cardId: 7, interval: 10 }), {
      lastReviewMs: new Map([[7, 1234]]),
      fsrs: new Map([[7, { difficulty: 4, stabilityDays: 15 }]]),
    });
    expect(m).toEqual({ intervalDays: 10, lastReviewMs: 1234, stabilityDays: 15 });
    expect(cardMemory(card({ cardId: 8, interval: 10 }), { fsrs: new Map([[8, null]]) })).toEqual({
      intervalDays: 10,
    });
  });

  it("takes the strongest card of a note", () => {
    expect(noteMemory([card({ interval: 4 }), card({ interval: 25 }), card({ type: 0 })])).toEqual({
      intervalDays: 25,
    });
    expect(noteMemory([card({ type: 0 })]).isNew).toBe(true);
  });
});
