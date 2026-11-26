import { describe, expect, it } from "vitest";
import { isSafe, need, pickWords, score, use, type WordSignals } from "./select.js";

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

const w = (key: string, over: Partial<WordSignals> = {}): WordSignals => ({
  key,
  state: "learning",
  pKnown: 0.5,
  hasCard: true,
  taps: 0,
  recentTaps: 0,
  netClozes: 0,
  reviewedToday: false,
  practiceSafe: false,
  onPage: false,
  onNextPages: false,
  zipf: 4,
  dismissed: false,
  ...over,
});

describe("picking a lesson's words (4.7.2)", () => {
  it("rates a halfway word above a safe one", () => {
    expect(need(w("a"), NOW)).toBeGreaterThan(need(w("b", { pKnown: 0.97 }), NOW));
  });

  it("puts a word tapped three times, lately, before an untapped one", () => {
    const tapped = w("tapped", { taps: 3, lastTapAt: NOW - DAY });
    expect(score(tapped, NOW)).toBeGreaterThan(score(w("plain"), NOW));
    expect(pickWords([w("plain"), tapped], [], 1, NOW)).toEqual(["tapped"]);
  });

  it("counts a recent miss", () => {
    expect(need(w("x", { lastWrongAt: NOW - 2 * DAY }), NOW)).toBeGreaterThan(need(w("x"), NOW));
    expect(need(w("x", { lastWrongAt: NOW - 30 * DAY }), NOW)).toBe(need(w("x"), NOW));
  });

  it("values words on the next pages and on this page", () => {
    expect(use(w("x", { onNextPages: true }))).toBeGreaterThan(use(w("x", { onPage: true })));
    expect(use(w("x", { onPage: true }))).toBeGreaterThan(use(w("x")));
  });

  it("leaves out ignored, dismissed and reviewed-today words", () => {
    const words = [
      w("ignored", { state: "ignored" }),
      w("dismissed", { dismissed: true }),
      w("today", { reviewedToday: true }),
      w("ok"),
    ];
    expect(pickWords(words, ["today"], 10, NOW)).toEqual(["ok"]);
  });

  it("keeps safe words only as a small check", () => {
    const safe = w("safe", { pKnown: 0.99, practiceSafe: true });
    expect(isSafe(safe)).toBe(true);
    expect(score(safe, NOW)).toBeLessThan(score(w("x", { pKnown: 0.99 }), NOW));
    expect(score(safe, NOW)).toBeGreaterThan(0);
  });

  it("takes due words first, then the best scores, up to n, in a stable order", () => {
    const words = [w("b"), w("a"), w("due"), w("c", { taps: 2 })];
    expect(pickWords(words, ["due"], 3, NOW)).toEqual(["due", "c", "a"]);
  });
});
