import { describe, expect, it } from "vitest";
import type { WordInfo } from "@app/db";
import { lessonCandidate, lessonSignals, toEloAnswers } from "./lessonSignals.js";

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

const info = (key: string, over: Partial<WordInfo> = {}): WordInfo =>
  ({
    key,
    state: "learning",
    pKnown: 0.5,
    source: "anki",
    decks: [],
    lookups: 0,
    noteIds: [],
    ...over,
  }) as WordInfo;

describe("lesson signals (algorithms.md 4.7.1)", () => {
  it("takes words you learn or know, and words you tapped", () => {
    expect(lessonCandidate(info("a"))).toBe(true);
    expect(lessonCandidate(info("b", { state: "seen" }))).toBe(false);
    expect(lessonCandidate(info("c", { state: "seen", lookups: 2 }))).toBe(true);
    expect(lessonCandidate(info("d", { state: "ignored", lookups: 2 }))).toBe(false);
  });

  it("reads taps, the last tap, misses and a safe streak", () => {
    const answers = toEloAnswers(
      [
        { key: "huis", kind: "gender", result: 0, at: NOW - 2 * DAY },
        { key: "fiets", kind: "scramble", result: 1, at: NOW - 3 },
        { key: "fiets", kind: "scramble", result: 1, at: NOW - 2 },
        { key: "fiets", kind: "cloze-typed", result: 1, at: NOW - 1 },
        { key: "x", kind: "no-such-kind", result: 1, at: NOW },
      ],
      new Set(["gender", "scramble", "cloze-typed"]),
    );
    expect(answers).toHaveLength(4);
    const [huis, fiets] = lessonSignals(
      [
        info("huis", { lookups: 4, lastLookupAt: NOW - DAY }),
        info("fiets", { evidence: { correct: 5, wrong: 0, lastAt: NOW } }),
      ],
      answers,
      NOW,
    );
    expect(huis).toMatchObject({
      taps: 4,
      recentTaps: 3,
      lastTapAt: NOW - DAY,
      lastWrongAt: NOW - 2 * DAY,
    });
    expect(fiets).toMatchObject({ practiceSafe: true, netClozes: 2, hasCard: true });
  });
});
