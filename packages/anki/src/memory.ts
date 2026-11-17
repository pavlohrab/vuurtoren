import type { CardMemory } from "@app/core";
import type { CardInfo } from "./client.js";

/** Convert an AnkiConnect card into the platform-neutral CardMemory. */
export function cardMemory(card: CardInfo): CardMemory {
  if (card.type === 0) return { intervalDays: 0, isNew: true };
  // Negative interval = seconds in (re)learning steps: reviewed, but well below a day.
  const intervalDays = card.interval < 0 ? Math.max(0.01, -card.interval / 86_400) : card.interval;
  return { intervalDays };
}

/** Strongest memory across a note's cards (forward/reverse): max interval, AnkiMorphs-style. */
export function noteMemory(cards: CardInfo[]): CardMemory {
  let best: CardMemory = { intervalDays: 0, isNew: true };
  for (const c of cards) {
    const m = cardMemory(c);
    if (best.isNew || (!m.isNew && m.intervalDays > best.intervalDays)) best = m;
  }
  return best;
}
