import type { AnalyzedToken } from "@app/core";
import { describe, expect, it } from "vitest";
import { roughTextLevel } from "./textLevel.js";

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
