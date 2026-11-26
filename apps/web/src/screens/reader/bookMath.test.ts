import { describe, expect, it } from "vitest";
import {
  DEFAULT_WPM,
  bookLayout,
  firstOnScreen,
  fitsSpread,
  itemAtChar,
  minutesFor,
  nextWpm,
  screenAt,
  screenCount,
  timeLeftLine,
} from "./bookMath.js";

describe("bookLayout", () => {
  it("a phone page: one column, the margins outside it, one turn is the whole width", () => {
    const l = bookLayout({ stage: 412, spread: false, margin: 22, maxPage: 700, fold: 80 });
    expect(l).toEqual({ perScreen: 1, col: 368, gap: 44, viewport: 368, side: 22, step: 412 });
  });

  it("a single page on a wide screen keeps its width and centres", () => {
    const l = bookLayout({ stage: 1000, spread: false, margin: 24, maxPage: 704, fold: 80 });
    expect(l.col).toBe(704);
    expect(l.side).toBe(148);
    expect(l.step).toBe(1000);
  });

  it("a spread: two pages and the fold, turned as one", () => {
    const l = bookLayout({ stage: 1200, spread: true, margin: 40, maxPage: 448, fold: 80 });
    expect(l).toEqual({ perScreen: 2, col: 448, gap: 80, viewport: 976, side: 112, step: 1056 });
  });

  it("a spread that is short of room shrinks its pages", () => {
    const l = bookLayout({ stage: 900, spread: true, margin: 40, maxPage: 448, fold: 80 });
    expect(l.col).toBe(370);
    expect(2 * l.col + l.gap + 2 * l.side).toBeLessThanOrEqual(900);
  });

  it("a spread fits from two pages of the smallest width", () => {
    expect(fitsSpread(760, 320, 80, 20)).toBe(true);
    expect(fitsSpread(759, 320, 80, 20)).toBe(false);
  });
});

describe("screens", () => {
  it("counts screens from where the text ends", () => {
    expect(screenCount(0, 412)).toBe(1);
    expect(screenCount(300, 412)).toBe(1);
    expect(screenCount(412, 412)).toBe(2);
    expect(screenCount(411.4, 412)).toBe(2);
    expect(screenCount(2 * 412 + 10, 412)).toBe(3);
    expect(screenCount(Number.NaN, 412)).toBe(1);
    expect(screenCount(500, 0)).toBe(1);
  });

  it("finds the screen of a point, clamped to the page", () => {
    expect(screenAt(0, 412, 3)).toBe(0);
    expect(screenAt(-0.5, 412, 3)).toBe(0);
    expect(screenAt(411.5, 412, 3)).toBe(1);
    expect(screenAt(830, 412, 3)).toBe(2);
    expect(screenAt(5000, 412, 3)).toBe(2);
    expect(screenAt(5000, 412, 1)).toBe(0);
  });

  it("finds the first word on a screen", () => {
    // Words 0-4 on screen 0, 5-9 on screen 1, 10-11 on screen 2.
    const of = (i: number) => (i < 5 ? 0 : i < 10 ? 1 : 2);
    expect(firstOnScreen(12, of, 0)).toBe(0);
    expect(firstOnScreen(12, of, 1)).toBe(5);
    expect(firstOnScreen(12, of, 2)).toBe(10);
    expect(firstOnScreen(12, of, 3)).toBe(-1);
    expect(firstOnScreen(0, of, 0)).toBe(-1);
  });

  it("finds the word at a saved character offset", () => {
    const starts = [0, 4, 9, 15, 22];
    expect(itemAtChar(starts, 0)).toBe(0);
    expect(itemAtChar(starts, 9)).toBe(2);
    expect(itemAtChar(starts, 10)).toBe(3);
    expect(itemAtChar(starts, 999)).toBe(4);
    expect(itemAtChar([], 3)).toBe(-1);
  });
});

describe("time left", () => {
  it("learns the reader's speed from finished pages, and ignores odd ones", () => {
    expect(nextWpm(DEFAULT_WPM, 200, 60_000)).toBe(130);
    // Skimmed (a page in two seconds) or put down for an hour: no change.
    expect(nextWpm(100, 200, 2000)).toBe(100);
    expect(nextWpm(100, 200, 3_600_000)).toBe(100);
    // Too short to say anything.
    expect(nextWpm(100, 10, 60_000)).toBe(100);
  });

  it("rounds to whole minutes, at least one while words are left", () => {
    expect(minutesFor(0, 100)).toBe(0);
    expect(minutesFor(20, 100)).toBe(1);
    expect(minutesFor(260, 100)).toBe(3);
  });

  it("says the page and the text", () => {
    expect(timeLeftLine(300, 2500, 100)).toBe("About 3 min left on this page, 25 in the text");
    expect(timeLeftLine(300, 300, 100)).toBe("About 3 min left in the text");
    expect(timeLeftLine(0, 0, 100)).toBe("Nothing left to read");
  });
});
