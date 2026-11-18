/**
 * Block segmentation: page text -> blocks (exercises, word-list sections, transcripts, grammar
 * chapters, other). Headers are recognised from the text ("Oefening 7", "Luisteren en spreken
 * Oefening 7", "Thema 3" in the word list, ...), tolerant of OCR damage. Pure.
 */
import { footerTheme } from "./outline.js";
import type { Block, BlockKind, OcrPage, Unit } from "./types.js";
import { EXERCISE_WORDS, UNIT_WORD_SRC } from "./vocab.js";

/** Skill labels the book prints in front of an exercise header. */
const SKILL = String.raw`(?:Luisteren en spreken|Luisteren en schrijven|Luisteren|Lezen|Spreken of schrijven|Spreken en schrijven|Spreken|Schrijven|Woordenschat|Grammatica|Uitspraak|Kijken|Spelling|Vocabulaire|Lezen en schrijven|Lezen en spreken)`;
/** Up to two junk tokens (icons the OCR read as symbols or stray capitals) may precede the header. */
const HEADER_RE = new RegExp(
  String.raw`^(?:(?:[^\p{Ll}\s]{1,3}|\p{Ll})\s+){0,2}?(?:(${SKILL})\s+)?(\p{Lu}\p{L}{3,11})\s+(\d{1,3})(?:\.\d{1,2})?\b[\s.:)]*(.*)$`,
  "u",
);
const UNIT_HEADING_RE = new RegExp(
  String.raw`^(${UNIT_WORD_SRC})\s+(\d{1,2})\b[\s.:–—-]*(.*)$`,
  "iu",
);
/** A unit word followed by a number anywhere in a line (running footers). */
const UNIT_MENTION_RE = new RegExp(String.raw`(?:${UNIT_WORD_SRC})\s+\d`, "iu");
const EXERCISE_WORD_SET: ReadonlySet<string> = new Set(EXERCISE_WORDS);

/** Levenshtein distance (small strings only). */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j] ?? 0;
      row[j] = Math.min(tmp + 1, (row[j - 1] ?? 0) + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length] ?? 0;
}

/**
 * True for "Oefening" (or an OCR variant such as "Oefeninq" / "Oetening"), "Opdracht", or the
 * exercise word of another language ("Exercise", "Übung", "Aufgabe", "Exercice", ...).
 */
export function isExerciseWord(word: string): boolean {
  const w = word.toLowerCase();
  if (EXERCISE_WORD_SET.has(w)) return true;
  if (w.length >= 7 && EXERCISE_WORDS.some((e) => e.length >= 7 && distance(w, e) <= 1))
    return true;
  return distance(w, "oefening") <= 2 || distance(w, "opdracht") <= 1;
}

export interface ExerciseHeader {
  /** The exercise word as printed ("Oefening", "Exercise"). */
  word: string;
  /** Skill label before the header ("Luisteren en spreken"), if any. */
  skill?: string;
  number: number;
  /** Rest of the header line (often the start of the instruction). */
  rest: string;
}

/** Parse an exercise header line, or null. */
export function parseExerciseHeader(line: string): ExerciseHeader | null {
  const m = HEADER_RE.exec(line.trim());
  if (!m || !isExerciseWord(m[2] ?? "")) return null;
  const out: ExerciseHeader = {
    word: m[2] ?? "Oefening",
    number: Number(m[3]),
    rest: (m[4] ?? "").trim(),
  };
  if (m[1]) out.skill = m[1];
  return out;
}

const normalizeLine = (l: string) => l.replace(/\d+/g, "#").trim().toLowerCase();

/**
 * Remove running headers/footers and bare page numbers: lines carrying the theme footer,
 * pure numbers, and short lines that repeat (modulo digits) on many pages.
 */
export function stripRunningText(pages: readonly OcrPage[]): OcrPage[] {
  const counts = new Map<string, number>();
  for (const p of pages) {
    for (const key of new Set(p.text.split("\n").map(normalizeLine))) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const threshold = Math.max(5, Math.ceil(pages.length * 0.03));
  const isRunning = (line: string): boolean => {
    const t = line.trim();
    if (/^\d{1,3}$/.test(t)) return true;
    const letters = t.replace(/[^\p{L}]/gu, "").length;
    if (letters < 6 || t.length > 70 || parseExerciseHeader(t) || UNIT_HEADING_RE.test(t))
      return false;
    return (counts.get(normalizeLine(t)) ?? 0) >= threshold;
  };
  return pages.map((p) => {
    const footer = footerTheme(p);
    const lines = p.text.split("\n").filter((l) => {
      if (isRunning(l)) return false;
      if (footer && UNIT_MENTION_RE.test(l) && l.trim().length < 90) {
        return !l.includes(footer.title);
      }
      return true;
    });
    return { ...p, text: lines.join("\n") };
  });
}

/** Collapse runs of blank lines and trim the ends. */
function tidy(lines: readonly string[]): string {
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface Open {
  kind: BlockKind;
  page: number;
  label?: string;
  number?: number;
  lines: string[];
}

/**
 * Split pages into blocks, independent of the outline (so that the outline can be edited
 * without the page text). A header line ("Oefening 7", "Thema 3") closes the current block and
 * opens a new one; a block keeps growing across page breaks. Exercise headers give `exercise`
 * blocks, everything else is `other`; {@link assignKinds} refines kinds from the outline.
 *
 * @param pages OCR'd pages (already stripped of running text)
 */
export function segmentPages(pages: readonly OcrPage[]): Block[] {
  const blocks: Block[] = [];
  let open: Open | null = null;
  const flush = () => {
    if (open) {
      const text = tidy(open.lines);
      if (text || open.label) {
        const b: Block = { page: open.page, kind: open.kind, text };
        if (open.label) b.label = open.label;
        if (open.number !== undefined) b.number = open.number;
        blocks.push(b);
      }
    }
    open = null;
  };

  for (const page of pages) {
    for (const raw of page.text.split("\n")) {
      const line = raw.trim();
      const ex = parseExerciseHeader(line);
      const section = UNIT_HEADING_RE.exec(line);
      if (ex) {
        flush();
        open = {
          kind: "exercise",
          page: page.n,
          label: `${ex.word} ${ex.number}`,
          number: ex.number,
          lines: ex.rest ? [ex.rest] : [],
        };
      } else if (section && line.length < 80) {
        flush();
        open = { kind: "other", page: page.n, label: `${section[1]} ${section[2]}`, lines: [] };
        if (section[3]?.trim()) open.lines.push(section[3].trim());
      } else {
        open ??= { kind: "other", page: page.n, lines: [] };
        open.lines.push(raw);
      }
    }
    // Pages are separated by a blank line inside a block that spans them.
    open?.lines.push("");
  }
  flush();
  return blocks;
}

/**
 * Give every block the kind its unit implies: pages of the word list, transcripts and grammar
 * units hold blocks of that kind; in themes exercise headers stay exercises. Pure; used again
 * whenever the outline changes.
 */
export function assignKinds(blocks: readonly Block[], units: readonly Unit[]): Block[] {
  const unitOf = (page: number) => units.find((u) => page >= u.pages[0] && page <= u.pages[1]);
  return blocks.map((b) => {
    const kind = unitOf(b.page)?.kind;
    const mapped: BlockKind | null =
      kind === "wordlist"
        ? "wordlist"
        : kind === "transcripts"
          ? "transcript"
          : kind === "grammar"
            ? "grammar"
            : null;
    // Grammar appendices hold exercises too ("Oefening 12"); transcripts and word lists do not.
    if (mapped === "grammar" && b.number !== undefined) return { ...b, kind: "exercise" };
    if (mapped) return { ...b, kind: mapped };
    // Reading texts marked by hand stay texts.
    if (b.kind === "text") return b;
    return { ...b, kind: b.number !== undefined ? "exercise" : "other" };
  });
}
