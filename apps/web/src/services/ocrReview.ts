/**
 * OCR review state: the recognised text stays as it came from the server, and each flagged word
 * carries the learner's decision (a fix, or "keep as is"). The text with the fixes applied is
 * derived, so offsets never shift while reviewing.
 */
import type { OcrFlag } from "@app/nlp-client";

export type ReviewFlag = OcrFlag & {
  status: "open" | "fixed" | "kept";
  /** The replacement when `status` is "fixed". */
  fix?: string;
};

export interface ReviewState {
  text: string;
  flags: ReviewFlag[];
}

/** A replacement of `[start, end)` of the original text. */
export interface TextEdit {
  start: number;
  end: number;
  text: string;
}

/** A picture of a page for the review screen (`src` is any image URL). */
export interface ReviewImage {
  src: string;
  width?: number;
  height?: number;
}

/** What the Import screen reviews: the whole recognised text, and the pictures of its pages. */
export interface OcrReviewDoc {
  text: string;
  flags: OcrFlag[];
  pages: { n: number; image: string; width: number; height: number }[];
}

/** Shows the review and resolves with the text to import, or null when the learner backs out. */
export type OcrReviewHandler = (doc: OcrReviewDoc) => Promise<string | null>;

/** One flagged page of a course book. `image` loads its picture (null: there is none). */
export interface CourseReviewPage {
  n: number;
  text: string;
  flags: OcrFlag[];
  image: (() => Promise<string | null>) | null;
}

/** Resolves with the edits per page number, or null to keep the text as recognised. */
export type CourseReviewHandler = (
  pages: CourseReviewPage[],
) => Promise<Map<number, TextEdit[]> | null>;

/** Thrown by an import when the learner left the review without importing. */
export class ImportCancelledError extends Error {
  constructor() {
    super("The import was cancelled.");
    this.name = "ImportCancelledError";
  }
}

export function initReview(text: string, flags: readonly OcrFlag[]): ReviewState {
  const sorted = [...flags].sort((a, b) => a.start - b.start);
  // Overlapping flags cannot both be applied: keep the first.
  const clean: ReviewFlag[] = [];
  for (const f of sorted) {
    const last = clean[clean.length - 1];
    if (f.end <= f.start || f.end > text.length) continue;
    if (last && f.start < last.end) continue;
    clean.push({ ...f, status: "open" });
  }
  return { text, flags: clean };
}

/** The flag's word as it now reads (its fix, or the recognised word). */
export const shownWord = (state: ReviewState, f: ReviewFlag) =>
  f.status === "fixed" && f.fix !== undefined ? f.fix : state.text.slice(f.start, f.end);

/** Text with every fix applied. */
export function reviewText(state: ReviewState): string {
  let out = "";
  let at = 0;
  for (const f of state.flags) {
    out += state.text.slice(at, f.start) + shownWord(state, f);
    at = f.end;
  }
  return out + state.text.slice(at);
}

/** The fixes as edits of the original text. */
export function reviewEdits(state: ReviewState): TextEdit[] {
  return state.flags
    .filter((f) => f.status === "fixed" && f.fix !== undefined)
    .map((f) => ({ start: f.start, end: f.end, text: f.fix ?? "" }));
}

const update = (state: ReviewState, i: number, patch: Partial<ReviewFlag>): ReviewState => ({
  ...state,
  flags: state.flags.map((f, k) => (k === i ? { ...f, ...patch } : f)),
});

/** Replace flag `i` with `fix` (a fix equal to the recognised word counts as "keep"). */
export function fixFlag(state: ReviewState, i: number, fix: string): ReviewState {
  const f = state.flags[i];
  if (!f) return state;
  if (fix === state.text.slice(f.start, f.end)) return keepFlag(state, i);
  return update(state, i, { status: "fixed", fix });
}

function setStatus(state: ReviewState, i: number, status: "open" | "kept"): ReviewState {
  return {
    ...state,
    flags: state.flags.map((f, k) => {
      if (k !== i) return f;
      const next: ReviewFlag = { ...f, status };
      delete next.fix;
      return next;
    }),
  };
}

export const keepFlag = (state: ReviewState, i: number) => setStatus(state, i, "kept");

/** Undo a decision: the flag is open again. */
export const reopenFlag = (state: ReviewState, i: number) => setStatus(state, i, "open");

/** Take the first suggestion of every open flag that has one. */
export function acceptAllSuggestions(state: ReviewState): ReviewState {
  return {
    ...state,
    flags: state.flags.map((f) =>
      f.status === "open" && f.suggestions[0] !== undefined
        ? { ...f, status: "fixed", fix: f.suggestions[0] }
        : f,
    ),
  };
}

export const openCount = (state: ReviewState) =>
  state.flags.filter((f) => f.status === "open").length;

export const suggestionCount = (state: ReviewState) =>
  state.flags.filter((f) => f.status === "open" && f.suggestions.length > 0).length;

export const changedCount = (state: ReviewState) =>
  state.flags.filter((f) => f.status === "fixed").length;

/** Index of the next (dir 1) or previous (dir -1) open flag after `from`, wrapping; -1 if none. */
export function nextOpen(state: ReviewState, from: number, dir: 1 | -1): number {
  const n = state.flags.length;
  for (let step = 1; step <= n; step++) {
    const i = (((from + dir * step) % n) + n) % n;
    if (state.flags[i]?.status === "open") return i;
  }
  return -1;
}

/**
 * After the learner edited the whole text by hand: the edited text becomes the new original.
 * Decided flags are part of it now; open ones are looked up again near where they were (by
 * their word) and dropped when the word is gone.
 */
export function rebase(state: ReviewState, edited: string): ReviewState {
  const flags: ReviewFlag[] = [];
  let shift = 0;
  let minStart = 0;
  for (const f of state.flags) {
    const was = state.text.slice(f.start, f.end);
    if (f.status !== "open") {
      shift += shownWord(state, f).length - was.length;
      continue;
    }
    const guess = Math.max(minStart, f.start + shift - 40);
    const at = edited.indexOf(was, guess);
    if (at >= 0 && at <= f.start + shift + 400) {
      flags.push({ ...f, start: at, end: at + was.length });
      minStart = at + was.length;
    }
  }
  return { text: edited, flags };
}

/**
 * Apply edits made on a course page's text (its blocks joined by blank lines) to the blocks.
 * An edit that spans a block break (a split hyphenation joined back) merges those blocks.
 */
export function applyEditsToBlocks<B extends { text: string }>(
  blocks: readonly B[],
  edits: readonly TextEdit[],
): B[] {
  if (edits.length === 0) return [...blocks];
  const ranges: { start: number; end: number }[] = [];
  let at = 0;
  for (const b of blocks) {
    ranges.push({ start: at, end: at + b.text.length });
    at += b.text.length + 2;
  }
  const out = blocks.map((b) => ({ ...b }));
  const removed = new Set<number>();
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    const first = ranges.findIndex((r) => e.start >= r.start && e.start <= r.end);
    const last = ranges.findIndex((r) => e.end >= r.start && e.end <= r.end);
    if (first < 0 || last < 0) continue;
    const fb = out[first];
    const lb = out[last];
    const fr = ranges[first];
    const lr = ranges[last];
    if (!fb || !lb || !fr || !lr) continue;
    const head = fb.text.slice(0, e.start - fr.start);
    const tail = lb.text.slice(e.end - lr.start);
    fb.text = head + e.text + tail;
    for (let k = first + 1; k <= last; k++) removed.add(k);
  }
  return out.filter((_, k) => !removed.has(k));
}
