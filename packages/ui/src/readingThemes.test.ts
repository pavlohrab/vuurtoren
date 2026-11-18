import { describe, expect, it } from "vitest";
import { READING_THEME_TOKENS, type ReadingThemeName, readingThemeStyle } from "./readingThemes.js";

function luminance(hex: string): number {
  const c = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255);
  const [r, g, b] = c.map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

/** Tokens the reader and its marks read (styles.css, Reader). */
const READER_TOKENS = [
  "--bg",
  "--surface",
  "--ink",
  "--ink-muted",
  "--hairline",
  "--accent",
  "--known",
  "--learn",
  "--learn-soft",
  "--state-new-bg",
  "--state-new-line",
  "--state-learning-line",
  "--state-gloss-line",
  "--state-grammar-line",
];

describe("reading themes", () => {
  for (const name of Object.keys(READING_THEME_TOKENS) as ReadingThemeName[]) {
    const t = READING_THEME_TOKENS[name];

    it(`${name}: sets every token the reader uses`, () => {
      const style = readingThemeStyle(name);
      for (const k of READER_TOKENS) expect(style[k], `${name} ${k}`).toBeTruthy();
    });

    it(`${name}: text is AA and word-state and grammar marks are at least 3:1`, () => {
      expect(contrast(t.ink, t.bg)).toBeGreaterThanOrEqual(7);
      expect(contrast(t.muted, t.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.muted, t.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.learnInk, t.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.ink, t.learnSoft)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.accentInk, t.accent)).toBeGreaterThanOrEqual(4.5);
      for (const line of [t.learn, t.known, t.grammar, t.accent])
        expect(contrast(line, t.bg), `${name} ${line}`).toBeGreaterThanOrEqual(3);
      // The grammar dots stay apart from the word-state colours.
      expect(t.grammar).not.toBe(t.learn);
      expect(t.grammar).not.toBe(t.known);
    });
  }
});
