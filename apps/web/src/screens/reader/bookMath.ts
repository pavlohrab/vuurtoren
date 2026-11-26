/**
 * The arithmetic of book mode (BookPages.tsx, algorithms.md 3): how a reader page is cut into
 * screens, which screen holds a word, and how long the rest will take. No DOM here, so it can
 * be tested on its own.
 *
 * One reader page flows into CSS columns. A screen is one column (a phone) or two side by side
 * (a spread). The columns are `col` wide with `gap` between them, and the viewport shows
 * exactly one screen, so turning moves the text sideways by `step = viewport + gap`.
 */

export interface BookLayout {
  /** Columns on one screen: 1, or 2 for a spread. */
  perScreen: 1 | 2;
  /** Width of one column (one book page) in px. */
  col: number;
  /** Space between two columns in px. On a phone this is both side margins. */
  gap: number;
  /** Width of the visible text area in px: one screen. */
  viewport: number;
  /** Space between the stage's edge and the text area, on each side. */
  side: number;
  /** How far one turn moves the text. */
  step: number;
}

export interface LayoutInput {
  /** The room the reader has, side to side, in px. */
  stage: number;
  /** Two pages side by side. */
  spread: boolean;
  /** Side margin on a single page, in px. */
  margin: number;
  /** The widest a page's text may be, in px. */
  maxPage: number;
  /** Space between the two pages of a spread (the fold), in px. */
  fold: number;
}

/** Lay one screen out in the stage. Widths are whole pixels, so columns never drift. */
export function bookLayout(i: LayoutInput): BookLayout {
  const stage = Math.max(0, Math.floor(i.stage));
  if (i.spread) {
    const col = Math.max(0, Math.floor(Math.min(i.maxPage, (stage - 2 * i.margin - i.fold) / 2)));
    const viewport = 2 * col + i.fold;
    const side = Math.max(0, Math.floor((stage - viewport) / 2));
    return { perScreen: 2, col, gap: i.fold, viewport, side, step: viewport + i.fold };
  }
  const col = Math.max(0, Math.floor(Math.min(i.maxPage, stage - 2 * i.margin)));
  const side = Math.max(0, Math.floor((stage - col) / 2));
  // The gap is both margins, so the next column waits just outside the text area.
  return { perScreen: 1, col, gap: 2 * side, viewport: col, side, step: col + 2 * side };
}

/** Is there room for a spread? Two pages of at least `minPage` px, the fold and the margins. */
export function fitsSpread(stage: number, minPage: number, fold: number, margin: number): boolean {
  return stage >= 2 * minPage + fold + 2 * margin;
}

/** The screen a point `x` px from the text's start falls on (x of a word, before any turn). */
export function screenAt(x: number, step: number, screens: number): number {
  if (step <= 0 || screens <= 1) return 0;
  // A pixel of slack: a word at the very start of a screen can measure as -0.5.
  const n = Math.floor((x + 1) / step);
  return Math.min(screens - 1, Math.max(0, n));
}

/**
 * How many screens the page has, from where its last line starts (`lastX`, the x of a marker
 * after the text). At least one.
 */
export function screenCount(lastX: number, step: number): number {
  if (step <= 0 || !Number.isFinite(lastX)) return 1;
  return Math.max(1, Math.floor((Math.max(0, lastX) + 1) / step) + 1);
}

/**
 * The first item on `screen`, when items run in reading order and `screenOf(i)` never goes
 * down as `i` grows (text in columns does that). Returns -1 when the screen has none.
 */
export function firstOnScreen(n: number, screenOf: (i: number) => number, screen: number): number {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (screenOf(mid) < screen) lo = mid + 1;
    else hi = mid;
  }
  return lo < n && screenOf(lo) === screen ? lo : -1;
}

/**
 * The index of the first item whose character offset is at or after `char` (the saved place),
 * from offsets in reading order. Past the end: the last item.
 */
export function itemAtChar(starts: readonly number[], char: number): number {
  if (starts.length === 0) return -1;
  let lo = 0;
  let hi = starts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((starts[mid] ?? 0) < char) lo = mid + 1;
    else hi = mid;
  }
  return Math.min(lo, starts.length - 1);
}

/** Words a minute before the reader's own speed is known: a slow, careful learner's pace. */
export const DEFAULT_WPM = 100;

/**
 * The reading speed after one more finished page: a running average that leans on the past.
 * A page read too fast (skimmed or turned past) or too slowly (put down) says nothing and is
 * left out, and so is a very short page.
 */
export function nextWpm(prev: number, words: number, ms: number): number {
  if (words < 15 || ms < 5000) return prev;
  const sample = words / (ms / 60_000);
  if (sample < 25 || sample > 450) return prev;
  return Math.round(prev * 0.7 + sample * 0.3);
}

/** Whole minutes for `words` at `wpm`, at least one while anything is left. */
export function minutesFor(words: number, wpm: number): number {
  if (words <= 0) return 0;
  return Math.max(1, Math.round(words / Math.max(1, wpm)));
}

/** "About 3 min left on this page, 25 in the text", or the short form on the last page. */
export function timeLeftLine(pageWords: number, textWords: number, wpm: number): string {
  const page = minutesFor(pageWords, wpm);
  const text = minutesFor(textWords, wpm);
  if (text <= 0) return "Nothing left to read";
  if (text === page) return `About ${text} min left in the text`;
  return `About ${page} min left on this page, ${text} in the text`;
}
