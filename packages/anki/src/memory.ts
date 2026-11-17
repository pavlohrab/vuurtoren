import type { CardMemory } from "@app/core";
import type { CardInfo, FsrsMemory } from "./client.js";

/** Extra per-card data fetched separately from cardsInfo. */
export interface CardExtras {
  lastReviewMs?: Map<number, number>;
  fsrs?: Map<number, FsrsMemory | null>;
}

/** Convert an AnkiConnect card into the platform-neutral CardMemory. */
export function cardMemory(card: CardInfo, extras: CardExtras = {}): CardMemory {
  if (card.type === 0) return { intervalDays: 0, isNew: true };
  // Negative interval = seconds in (re)learning steps: reviewed, but well below a day.
  const intervalDays = card.interval < 0 ? Math.max(0.01, -card.interval / 86_400) : card.interval;
  const memory: CardMemory = { intervalDays };
  const last = extras.lastReviewMs?.get(card.cardId);
  if (last !== undefined) memory.lastReviewMs = last;
  const fsrs = extras.fsrs?.get(card.cardId);
  if (fsrs) memory.stabilityDays = fsrs.stabilityDays;
  return memory;
}

/** Strongest memory across a note's cards (forward/reverse): max interval, AnkiMorphs-style. */
export function noteMemory(cards: CardInfo[], extras: CardExtras = {}): CardMemory {
  let best: CardMemory = { intervalDays: 0, isNew: true };
  for (const c of cards) {
    const m = cardMemory(c, extras);
    if (best.isNew || (!m.isNew && m.intervalDays > best.intervalDays)) best = m;
  }
  return best;
}
