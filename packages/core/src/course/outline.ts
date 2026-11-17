/**
 * Outline detection from OCR'd pages: the table of contents ("Inhoud": titles + page numbers)
 * and the running footers that name the theme ("Thema 1 Kennismaken en afspreken 15").
 * Pure; works on page text only. The user always confirms the result in the outline editor.
 */
import type { OcrPage, Unit, UnitKind } from "./types.js";

/** Words that introduce a numbered unit in a footer or title. */
const UNIT_WORD = "(?:Thema|Hoofdstuk|Les|Unit|Module|Chapter|Lektion)";
const FOOTER_RE = new RegExp(
  `\\b(${UNIT_WORD})\\s+(\\d{1,2})\\s+(\\p{L}[\\p{L}\\s,'’&-]*?)(?=\\s+\\d{1,3}\\b|\\s*$)`,
  "u",
);
const CONTENTS_HEADING_RE = /^(inhoud|inhoudsopgave|contents|table of contents)\s*$/i;
const ENTRY_RE = /^(.{3,80}?)[\s.·…]+(\d{1,3})\s*$/u;
const APPENDIX_RE = {
  grammar: /^(grammatica|grammaticaal|grammatical|grammar)/i,
  transcripts: /^(transcript|luisterteksten)/i,
  wordlist: /^(woordenlijst|woordenschat|vocabulary|glossary|word list)/i,
};
const FRONT_MATTER_RE = /^(voorwoord|inleiding|introductie|preface|introduction|colofon)/i;

export interface FooterTheme {
  /** PDF page index (1-based). */
  page: number;
  word: string;
  n: number;
  title: string;
  /** Printed page number from the footer, when present. */
  printed?: number;
}

/** Find the "Thema N Title [page]" footer line of a page, if any. */
export function footerTheme(page: OcrPage): FooterTheme | null {
  const lines = page.text.split("\n").map((l) => l.trim());
  // Footers are short and sit at the end (or, for some layouts, at the top) of the page.
  const candidates = [...lines.slice(-4), ...lines.slice(0, 2)].filter(
    (l) => l.length > 0 && l.length < 90,
  );
  for (const line of candidates) {
    const m = FOOTER_RE.exec(line);
    if (!m) continue;
    const title = (m[3] ?? "").trim();
    if (title.split(/\s+/).length > 8 || title.length < 3) continue;
    const num = /(?:^|\s)(\d{1,3})(?=\s+\D|\s*$)/.exec(line.replace(m[0], " "));
    const printed = num?.[1] ? Number(num[1]) : undefined;
    const out: FooterTheme = { page: page.n, word: m[1] ?? "Thema", n: Number(m[2]), title };
    if (printed !== undefined) out.printed = printed;
    return out;
  }
  return null;
}

/** Pages whose footer names a theme, in page order. */
export function footerThemes(pages: readonly OcrPage[]): FooterTheme[] {
  return pages.flatMap((p) => footerTheme(p) ?? []);
}

/** The most common value of a list (ties: the smallest), or undefined for an empty list. */
function mode(values: readonly number[]): number | undefined {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
}

/** The most frequent string of a list when it occurs at least twice, else undefined. */
function commonest(values: readonly string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const top = [...counts].sort((a, b) => b[1] - a[1])[0];
  return top && top[1] >= 2 ? top[0] : undefined;
}

/**
 * Offset between PDF page index and printed page number (`pdf = printed + offset`), estimated
 * from footers that carry both. 0 when nothing is known.
 */
export function pageOffset(footers: readonly FooterTheme[]): number {
  const diffs = footers.flatMap((f) => (f.printed !== undefined ? [f.page - f.printed] : []));
  return mode(diffs) ?? 0;
}

export interface ContentsEntry {
  title: string;
  /** Printed page number. */
  page: number;
  /** True for entries listed under a "Grammatica" heading (chapters of the appendix). */
  inGrammar: boolean;
}

/**
 * Parse the table of contents: lines "Title ..... 52" on the pages following an "Inhoud"
 * heading (within the first `scan` pages). A bare "Grammatica" heading marks that the
 * following entries are chapters of the grammar appendix.
 */
export function parseContents(pages: readonly OcrPage[], scan = 15): ContentsEntry[] {
  const start = pages.slice(0, scan).findIndex((p) =>
    p.text
      .split("\n")
      .slice(0, 6)
      .some((l) => CONTENTS_HEADING_RE.test(l.trim())),
  );
  if (start < 0) return [];
  const entries: ContentsEntry[] = [];
  let inGrammar = false;
  for (let i = start; i < Math.min(pages.length, start + 3); i++) {
    const before = entries.length;
    for (const raw of (pages[i]?.text ?? "").split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      if (APPENDIX_RE.grammar.test(line) && !/\d$/.test(line)) {
        inGrammar = true;
        continue;
      }
      const m = ENTRY_RE.exec(line);
      if (!m || /^\d+$/.test(m[1] ?? "")) continue;
      const title = (m[1] ?? "").replace(/^[\d\W_]+/u, "").trim();
      if (title.length < 3) continue;
      entries.push({ title, page: Number(m[2]), inGrammar });
    }
    // A page without any entry ends the contents (the Inhoud page itself may be sparse).
    if (i > start && entries.length === before) break;
  }
  return entries;
}

function appendixKind(title: string): UnitKind | null {
  if (APPENDIX_RE.transcripts.test(title)) return "transcripts";
  if (APPENDIX_RE.wordlist.test(title)) return "wordlist";
  if (APPENDIX_RE.grammar.test(title)) return "grammar";
  return null;
}

/** Plain unit before range computation. */
interface Draft {
  title: string;
  kind: UnitKind;
  start: number;
}

/** Drafts from the contents: themes first, then the appendices (grammar chapters merged). */
function draftsFromContents(entries: readonly ContentsEntry[], offset: number): Draft[] {
  const drafts: Draft[] = [];
  let theme = 0;
  let grammarAdded = false;
  for (const e of entries) {
    if (FRONT_MATTER_RE.test(e.title)) continue;
    const start = e.page + offset;
    const appendix = appendixKind(e.title);
    // Transcripts and the word list end the grammar section even though they follow it.
    if (appendix === "transcripts" || appendix === "wordlist") {
      drafts.push({ title: e.title, kind: appendix, start });
      continue;
    }
    if (e.inGrammar || appendix === "grammar") {
      if (!grammarAdded) {
        drafts.push({ title: "Grammatica", kind: "grammar", start });
        grammarAdded = true;
      }
      continue;
    }
    // Entries after the appendices began (e.g. "Onregelmatige verba") stay with the previous unit.
    if (drafts.some((d) => d.kind !== "theme")) continue;
    theme++;
    drafts.push({ title: `Thema ${theme} ${e.title}`, kind: "theme", start });
  }
  return drafts;
}

/**
 * Build the outline of a book. Uses the contents when present (themes numbered in order,
 * appendices as grammar / transcripts / word list units) and the footers to confirm titles,
 * or the footers alone when there is no contents page. Falls back to a single unit.
 *
 * @param pages OCR'd pages (1-based `n`)
 * @param courseId id stored on every unit
 */
export function detectOutline(pages: readonly OcrPage[], courseId: string): Unit[] {
  const last = pages.length;
  const footers = footerThemes(pages);
  const offset = pageOffset(footers);
  const entries = parseContents(pages);
  let drafts = draftsFromContents(entries, offset);
  // Contents entries must run forward through the book; otherwise the OCR is not trusted.
  const sorted = drafts.every((d, i) => i === 0 || d.start > (drafts[i - 1]?.start ?? 0));
  if (!sorted || drafts.filter((d) => d.kind === "theme").length < 1) drafts = [];

  if (drafts.length === 0) {
    // Footers alone: first page of every named theme starts a unit.
    const seen = new Map<number, { title: string; start: number }>();
    for (const f of footers) if (!seen.has(f.n)) seen.set(f.n, { title: f.title, start: f.page });
    drafts = [...seen]
      .sort((a, b) => a[0] - b[0])
      .map(([n, v]) => ({
        title: `Thema ${n} ${v.title}`,
        kind: "theme" as const,
        start: v.start,
      }));
  } else {
    // Prefer the (cleaner) footer title when the footers name this theme number.
    const byNumber = new Map<number, string[]>();
    for (const f of footers) byNumber.set(f.n, [...(byNumber.get(f.n) ?? []), f.title]);
    drafts = drafts.map((d) => {
      const n = /^Thema (\d+)/.exec(d.title)?.[1];
      const best = n ? commonest(byNumber.get(Number(n)) ?? []) : undefined;
      return best ? { ...d, title: `Thema ${n} ${best}` } : d;
    });
  }
  if (drafts.length === 0) {
    return [
      {
        courseId,
        n: 1,
        title: "Hele boek",
        pages: [1, Math.max(1, last)],
        ankiDecks: [],
        kind: "other",
      },
    ];
  }
  return drafts.map((d, i) => ({
    courseId,
    n: i + 1,
    title: d.title,
    pages: [
      Math.min(d.start, last),
      Math.max(Math.min(d.start, last), (drafts[i + 1]?.start ?? last + 1) - 1),
    ] as [number, number],
    ankiDecks: [],
    kind: d.kind,
  }));
}

/**
 * Check an edited outline before it is saved: every unit needs whole page numbers within the
 * book, the first page not after the last, and no two units may share a page.
 *
 * @param rows units as edited (titles and inclusive page ranges)
 * @param pageCount pages in the source (0 or less: unknown, no upper bound)
 * @returns a message for the user, or null when the outline is valid
 */
export function validateOutline(
  rows: readonly { title: string; pages: readonly [number, number] }[],
  pageCount: number,
): string | null {
  if (rows.length === 0) return "Add at least one unit.";
  const named = (i: number) => rows[i]?.title.trim() || `Unit ${i + 1}`;
  for (const [i, r] of rows.entries()) {
    const [from, to] = r.pages;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < 1) {
      return `${named(i)}: page numbers must be whole numbers from 1.`;
    }
    if (from > to) return `${named(i)}: the first page comes after the last page.`;
    if (pageCount > 0 && to > pageCount) {
      return `${named(i)}: the book has only ${pageCount} pages.`;
    }
  }
  const order = rows.map((r, i) => ({ i, from: r.pages[0], to: r.pages[1] }));
  order.sort((a, b) => a.from - b.from);
  for (let k = 1; k < order.length; k++) {
    const prev = order[k - 1];
    const cur = order[k];
    if (prev && cur && cur.from <= prev.to) {
      return `${named(prev.i)} and ${named(cur.i)} share page ${cur.from}.`;
    }
  }
  return null;
}
