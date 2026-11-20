import type { StarterWord } from "@app/anki";
import { describe, expect, it } from "vitest";
import {
  groupByLevel,
  inLevel,
  levelLabel,
  levelOf,
  levelProgress,
  parseLevel,
  progressText,
  starterIndex,
} from "./levels.js";

/** A starter list of 1200 words: w1 … w1200 (levels 1–3, the last one 200 words). */
const WORDS: StarterWord[] = Array.from({ length: 1200 }, (_, i) => ({
  rank: i + 1,
  word: `w${i + 1}`,
  pos: "noun",
  gloss: "",
}));
const index = starterIndex(WORDS);

describe("starter levels", () => {
  it("reads levels from ranks, whatever decks exist", () => {
    expect(levelOf(index, "w1")).toBe(1);
    expect(levelOf(index, "w500")).toBe(1);
    expect(levelOf(index, "w501")).toBe(2);
    expect(levelOf(index, "huis")).toBeNull();
    expect(levelLabel(index, 1)).toBe("Level 1 · 1–500");
    expect(levelLabel(index, 3)).toBe("Level 3 · 1001–1200");
    expect(levelLabel(index, null)).toBe("Other words");
  });

  it("parses the level search param", () => {
    expect(parseLevel("2", index)).toBe(2);
    expect(parseLevel("other", index)).toBe("other");
    expect(parseLevel("4", index)).toBeNull(); // no such level
    expect(parseLevel("0")).toBeNull();
    expect(parseLevel("x")).toBeNull();
    expect(parseLevel(undefined)).toBeNull();
  });

  it("filters rows by level, or to the words outside the list", () => {
    const rows = [{ key: "w600" }, { key: "huis" }, { key: "w2" }, { key: "w900" }];
    expect(inLevel(rows, index, 2).map((r) => r.key)).toEqual(["w600", "w900"]);
    expect(inLevel(rows, index, "other").map((r) => r.key)).toEqual(["huis"]);
  });

  it("groups rows by level in rank order, other words last", () => {
    const rows = ["zon", "w900", "w3", "w501", "huis", "w1"].map((key) => ({ key }));
    expect(groupByLevel(rows, index).map((g) => [g.level, g.rows.map((r) => r.key)])).toEqual([
      [1, ["w1", "w3"]],
      [2, ["w501", "w900"]],
      [null, ["zon", "huis"]],
    ]);
  });

  it("counts known and learning words per level out of the level's size", () => {
    const words = [
      { key: "w1", state: "known" as const },
      { key: "w2", state: "known" as const },
      { key: "w3", state: "learning" as const },
      { key: "w4", state: "unknown" as const },
      { key: "w1100", state: "learning" as const },
      { key: "huis", state: "known" as const },
    ];
    const p = levelProgress(index, words);
    expect(p).toEqual([
      { level: 1, size: 500, known: 2, learning: 1 },
      { level: 2, size: 500, known: 0, learning: 0 },
      { level: 3, size: 200, known: 0, learning: 1 },
    ]);
    expect(progressText(p[0]!)).toBe("2 of 500 known · 1 learning");
    expect(progressText(p[1]!)).toBe("0 of 500 known");
  });
});
