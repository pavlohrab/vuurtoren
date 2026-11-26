import type { AnalyzedToken } from "@app/core";
import { describe, expect, it } from "vitest";
import { grammarLevel, levelsLine, roughTextLevel } from "./textLevel.js";

const tok = (lemma: string, extra: Partial<AnalyzedToken> = {}): AnalyzedToken =>
  ({
    lemma,
    is_word: true,
    is_propn: false,
    is_num: false,
    particle_of: null,
    ...extra,
  }) as AnalyzedToken;

/** Ranks 1–20 for "w1"…"w20", and "rare" at 3000. */
const RANK = new Map<string, number>([
  ...Array.from({ length: 20 }, (_, i) => [`w${i + 1}`, i + 1] as [string, number]),
  ["mid", 1500],
  ["rare", 3000],
]);

describe("roughTextLevel", () => {
  it("is the first band that holds 95% of the running words", () => {
    const common = Array.from({ length: 19 }, (_, i) => tok(`w${i + 1}`));
    expect(roughTextLevel([...common, tok("w20")], RANK)).toBe("A1");
    expect(roughTextLevel([...common, tok("mid")], RANK)).toBe("A1"); // 19/20 = 95%
    expect(roughTextLevel([...common.slice(0, 18), tok("mid"), tok("mid")], RANK)).toBe("A2");
    expect(roughTextLevel([...common.slice(0, 18), tok("rare"), tok("rare")], RANK)).toBe("B1");
    expect(roughTextLevel([...common.slice(0, 18), tok("xx"), tok("yy")], RANK)).toBe("C1");
  });

  it("leaves out names, numbers and the detached half of a split verb", () => {
    const common = Array.from({ length: 10 }, (_, i) => tok(`w${i + 1}`));
    const extra = [
      tok("Kampen", { is_propn: true }),
      tok("12", { is_num: true }),
      tok("open", { particle_of: 3 }),
    ];
    expect(roughTextLevel([...common, ...extra], RANK)).toBe("A1");
    expect(roughTextLevel([tok("Kampen", { is_propn: true })], RANK)).toBeNull();
  });
});

describe("grammarLevel (LV8)", () => {
  const hits = (...ids: string[]) => ids.map((topic) => ({ topic }));
  it("is the first level holding 80% of the grammar hits", () => {
    expect(grammarLevel(hits("de-het", "demonstratives", "dates-and-time", "comparison"))).toBe(
      "A2",
    );
    expect(grammarLevel(hits("de-het", "de-het", "de-het", "de-het", "comparison"))).toBe("A1");
    expect(grammarLevel(hits("adverbs", "conditional", "er", "de-het"))).toBe("B1");
  });
  it("says nothing with fewer than three hits, or topics it doesn't know", () => {
    expect(grammarLevel(hits("de-het", "conditional"))).toBeNull();
    expect(grammarLevel(hits("nope", "nope", "nope"))).toBeNull();
  });
  it("reads as one quiet line", () => {
    expect(levelsLine("A1", "A2")).toBe("A1 words · A2 grammar");
    expect(levelsLine(null, "B1")).toBe("B1 grammar");
    expect(levelsLine(undefined, null)).toBeNull();
  });
});
