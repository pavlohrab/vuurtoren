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
  });

  it("takes the strongest card of a note", () => {
    expect(noteMemory([card({ interval: 4 }), card({ interval: 25 }), card({ type: 0 })])).toEqual({
      intervalDays: 25,
    });
    expect(noteMemory([card({ type: 0 })]).isNew).toBe(true);
  });
});
