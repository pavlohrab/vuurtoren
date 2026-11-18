/**
 * Outline detection from OCR'd pages: the table of contents ("Inhoud": titles + page numbers)
 * and the running footers that name the theme ("Thema 1 Kennismaken en afspreken 15").
 * Pure; works on page text only. The user always confirms the result in the outline editor.
 */
import type { OcrPage, Unit, UnitKind } from "./types.js";
import { APPENDIX_RE, CONTENTS_HEADING_RE, FRONT_MATTER_RE, UNIT_WORD_SRC } from "./vocab.js";

/** Words that introduce a numbered unit in a footer or title (any of the supported languages). */
const UNIT_WORD = UNIT_WORD_SRC;
const FOOTER_RE = new RegExp(
  `\\b(${UNIT_WORD})\\s+(\\d{1,2})\\s+(\\p{L}[\\p{L}\\s,'’&-]*?)(?=\\s+\\d{1,3}\\b|\\s*$)`,
  "u",
);
/** A unit heading at the top of a page or chapter: "Lektion 3: Einkaufen", "Chapter 3 - Food", "Unit 3". */
const HEADING_RE = new RegExp(`^(${UNIT_WORD})\\s+(\\d{1,2})\\b\\s*[.:–—-]?\\s*(.{0,60})$`, "iu");
/** A contents line: title, dot leaders or spaces, page number. */
const ENTRY_RE = /^(.{3,80}?)[\s.·…]+(\d{1,3})\s*$/u;
/** A contents title that already names its unit ("Unit 3 Food", "Lektion 3: Einkaufen"). */
const NAMED_ENTRY_RE = new RegExp(`^(${UNIT_WORD})\\s+(\\d{1,2})\\b\\s*[.:–—-]?\\s*(.*)$`, "iu");

/** "thema's" / "Chapters" heading in a contents page: the unit word the book uses. */
function unitWordOf(line: string): string | null {
  const m = new RegExp(`^(${UNIT_WORD})(?:'s|s|en|e)?\\s*$`, "iu").exec(line.trim());
  return m?.[1] ?? null;
}

/** The first `k` non-empty lines of a page, trimmed. */
function topLines(page: OcrPage, k: number): string[] {
  return page.text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, k);
}

/** Words of a title worth matching (four letters or more), lowercase. */
function titleWords(title: string): string[] {
  return (title.toLowerCase().match(/\p{L}{4,}/gu) ?? []).slice(0, 3);
}

/** Capitalise the first letter ("thema" -> "Thema"). */
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

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

/** The most frequent string of a list (no minimum count), or undefined for an empty list. */
function commonestString(values: readonly string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/**
 * Appendix headings (grammar, transcripts, word list) at the top of pages after the last unit
 * started: used when there is no contents page.
 */
function appendixHeadings(pages: readonly OcrPage[], after: number): Draft[] {
  const out: Draft[] = [];
  for (const p of pages) {
    if (p.n <= after) continue;
    const first = p.text
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean);
    if (!first || first.length > 40) continue;
    const kind = appendixKind(first);
    if (kind && !out.some((d) => d.kind === kind)) out.push({ title: first, kind, start: p.n });
  }
  return out;
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

/**
 * Offset from printed page numbers alone: a number that ends one of the last two lines (or
 * starts one of the first two) of a page, "Everyday English 12" or a bare "12". Needs agreement
 * on at least three pages; null otherwise.
 */
export function printedPageOffset(pages: readonly OcrPage[]): number | null {
  const diffs: number[] = [];
  for (const p of pages) {
    const lines = p.text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const cands = [
      ...lines.slice(-2).map((l) => /(?:^|\s)(\d{1,3})$/.exec(l)?.[1]),
      ...lines.slice(0, 2).map((l) => /^(\d{1,3})(?:\s|$)/.exec(l)?.[1]),
    ].filter((x): x is string => !!x);
    const printed = cands.map(Number).find((x) => x > 0 && x <= p.n);
    if (printed !== undefined) diffs.push(p.n - printed);
  }
  const best = mode(diffs);
  return best !== undefined && diffs.filter((d) => d === best).length >= 3 ? best : null;
}

/**
 * Offset from the contents titles themselves: the page (at or after the printed number) whose
 * first lines carry the entry's title. Works without any page numbers on the pages.
 */
export function titleOffset(
  entries: readonly ContentsEntry[],
  pages: readonly OcrPage[],
): number | null {
  const diffs: number[] = [];
  for (const e of entries) {
    const words = titleWords(e.title);
    if (words.length === 0) continue;
    for (let d = 0; d <= 40; d++) {
      const page = pages.find((p) => p.n === e.page + d);
      if (!page) break;
      const top = topLines(page, 4).join(" ").toLowerCase();
      if (words.every((w) => top.includes(w))) {
        diffs.push(d);
        break;
      }
    }
  }
  const best = mode(diffs);
  return best !== undefined && diffs.filter((d) => d === best).length >= Math.min(2, entries.length)
    ? best
    : null;
}

export interface ContentsEntry {
  /** Title without its unit word and number ("Kennismaken"). */
  title: string;
  /** The unit word and number when the entry names them ("Lektion", 3). */
  unitWord?: string;
  unitN?: number;
  /** Printed page number. */
  page: number;
  /** True for entries listed under a "Grammatica" heading (chapters of the appendix). */
  inGrammar: boolean;
  /** That heading as printed ("Grammatica", "Grammar"). */
  group?: string;
}

/**
 * Parse the table of contents: lines "Title ..... 52" on the pages following an "Inhoud"
 * heading (within the first `scan` pages). A bare "Grammatica" heading marks that the
 * following entries are chapters of the grammar appendix.
 */
export function parseContents(pages: readonly OcrPage[], scan = 15): ContentsEntry[] {
  return parseContentsWithWord(pages, scan).entries;
}

/** {@link parseContents}, plus the unit word of a section heading such as "Thema's". */
export function parseContentsWithWord(
  pages: readonly OcrPage[],
  scan = 15,
): { entries: ContentsEntry[]; unitWord: string | null } {
  let unitWord: string | null = null;
  const start = pages.slice(0, scan).findIndex((p) =>
    p.text
      .split("\n")
      .slice(0, 6)
      .some((l) => CONTENTS_HEADING_RE.test(l.trim())),
  );
  if (start < 0) return { entries: [], unitWord };
  const entries: ContentsEntry[] = [];
  let inGrammar = false;
  let group: string | undefined;
  for (let i = start; i < Math.min(pages.length, start + 3); i++) {
    const before = entries.length;
    for (const raw of (pages[i]?.text ?? "").split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      if (APPENDIX_RE.grammar.test(line) && !/\d$/.test(line)) {
        inGrammar = true;
        group = line;
        continue;
      }
      const word = unitWordOf(line);
      if (word) {
        unitWord ??= cap(word);
        continue;
      }
      const m = ENTRY_RE.exec(line);
      if (!m || /^\d+$/.test(m[1] ?? "")) continue;
      const named = NAMED_ENTRY_RE.exec((m[1] ?? "").trim());
      const title = (named ? (named[3] ?? "") : (m[1] ?? ""))
        .replace(/^[\d\W_]+/u, "")
        .replace(/[\s.·…]+$/u, "")
        .trim();
      if (title.length < 3 && !named) continue;
      const entry: ContentsEntry = { title, page: Number(m[2]), inGrammar };
      if (inGrammar && group) entry.group = group;
      if (named) {
        entry.unitWord = cap(named[1] ?? "");
        entry.unitN = Number(named[2]);
        unitWord ??= entry.unitWord;
      }
      entries.push(entry);
    }
    // A page without any entry ends the contents (the Inhoud page itself may be sparse).
    if (i > start && entries.length === before) break;
  }
  return { entries, unitWord };
}

function appendixKind(title: string): UnitKind | null {
  if (APPENDIX_RE.transcripts.test(title)) return "transcripts";
  if (APPENDIX_RE.wordlist.test(title)) return "wordlist";
  if (APPENDIX_RE.grammar.test(title)) return "grammar";
  return null;
}

/** "Thema 3 Winkelen", "Lektion 3 Einkaufen", or "3 Food" for a book without a unit word. */
export function unitTitle(word: string | null | undefined, n: number, title: string): string {
  return [word, String(n), title].filter(Boolean).join(" ").trim();
}

/** Unit headings at the top of pages (first three lines): first page per unit number. */
export function headingUnits(pages: readonly OcrPage[]): FooterTheme[] {
  const out: FooterTheme[] = [];
  for (const p of pages) {
    const top = p.text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 3);
    for (const line of top) {
      const m = HEADING_RE.exec(line);
      if (!m) continue;
      const n = Number(m[2]);
      if (out.some((f) => f.n === n)) break;
      out.push({ page: p.n, word: cap(m[1] ?? ""), n, title: (m[3] ?? "").trim() });
      break;
    }
  }
  // Keep the run of increasing unit numbers (cross references such as "see Unit 2" drop out).
  return out.filter((f, i) => i === 0 || f.n > (out[i - 1]?.n ?? 0));
}

/** Plain unit before range computation. */
interface Draft {
  title: string;
  kind: UnitKind;
  start: number;
}

/** Drafts from the contents: themes first, then the appendices (grammar chapters merged). */
function draftsFromContents(
  entries: readonly ContentsEntry[],
  offset: number,
  unitWord: string | null,
): Draft[] {
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
        drafts.push({ title: e.group ?? e.title, kind: "grammar", start });
        grammarAdded = true;
      }
      continue;
    }
    // Entries after the appendices began (e.g. "Onregelmatige verba") stay with the previous unit.
    if (drafts.some((d) => d.kind !== "theme")) continue;
    theme++;
    drafts.push({
      title: unitTitle(e.unitWord ?? unitWord, e.unitN ?? theme, e.title),
      kind: "theme",
      start,
    });
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
  const { entries, unitWord: contentsWord } = parseContentsWithWord(pages);
  const offset = footers.some((f) => f.printed !== undefined)
    ? pageOffset(footers)
    : (printedPageOffset(pages) ?? titleOffset(entries, pages) ?? 0);
  const footerWord = commonestString(footers.map((f) => cap(f.word)));
  const word = contentsWord ?? footerWord ?? null;
  let drafts = draftsFromContents(entries, offset, word);
  // Contents entries must run forward through the book; otherwise the OCR is not trusted.
  const sorted = drafts.every((d, i) => i === 0 || d.start > (drafts[i - 1]?.start ?? 0));
  if (!sorted || drafts.filter((d) => d.kind === "theme").length < 1) drafts = [];

  if (drafts.length === 0) {
    // Footers (or, without footers, unit headings at the top of pages): the first page of
    // every named unit starts it.
    const marks = footers.length >= 2 ? footers : headingUnits(pages);
    const seen = new Map<number, { title: string; start: number; word: string }>();
    for (const f of marks)
      if (!seen.has(f.n)) seen.set(f.n, { title: f.title, start: f.page, word: cap(f.word) });
    // A unit's opening page often has no footer, only its title: start there instead.
    for (const v of seen.values()) {
      const before = pages.find((p) => p.n === v.start - 1);
      const key = titleWords(v.title)[0];
      if (
        before &&
        key &&
        !footerTheme(before) &&
        topLines(before, 3).some((l) => l.toLowerCase().includes(key))
      )
        v.start -= 1;
    }
    drafts = [...seen]
      .sort((a, b) => a[0] - b[0])
      .filter(([, v], i, all) => i === 0 || v.start > (all[i - 1]?.[1].start ?? 0))
      .map(([n, v]) => ({
        title: unitTitle(v.word, n, v.title),
        kind: "theme" as const,
        start: v.start,
      }));
    const lastMarked = Math.max(0, ...marks.map((f) => f.page));
    drafts = [...drafts, ...appendixHeadings(pages, lastMarked)];
  } else {
    // Prefer the (cleaner) footer title when the footers name this unit number.
    const byNumber = new Map<number, string[]>();
    for (const f of footers) byNumber.set(f.n, [...(byNumber.get(f.n) ?? []), f.title]);
    drafts = drafts.map((d) => {
      if (d.kind !== "theme") return d;
      const m = /^(\p{L}+ )?(\d+)\b/u.exec(d.title);
      const n = m?.[2];
      const best = n ? commonest(byNumber.get(Number(n)) ?? []) : undefined;
      return best ? { ...d, title: unitTitle(m?.[1]?.trim() ?? word, Number(n), best) } : d;
    });
  }
  if (drafts.length === 0) {
    return [
      {
        courseId,
        n: 1,
        title: "Whole book",
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

/** An outline row as the editor holds it. */
export interface OutlineEditRow {
  title: string;
  pages: [number, number];
  kind: UnitKind;
}

/**
 * Start a new unit at `page` (the outline editor's "New unit from here"): the unit that holds
 * the page ends just before it, and the new one runs to that unit's old end. A page before
 * every unit opens a unit up to the first one. Pure; returns the rows sorted by page.
 */
export function splitOutlineAt(
  rows: readonly OutlineEditRow[],
  page: number,
  title: string,
  kind: UnitKind = "theme",
): OutlineEditRow[] {
  const sorted = [...rows].sort((a, b) => a.pages[0] - b.pages[0]);
  const i = sorted.findIndex((r) => page >= r.pages[0] && page <= r.pages[1]);
  if (i >= 0) {
    const r = sorted[i]!;
    if (r.pages[0] === page) return sorted;
    const out = [...sorted];
    out.splice(
      i,
      1,
      { ...r, pages: [r.pages[0], page - 1] },
      { title, kind, pages: [page, r.pages[1]] },
    );
    return out;
  }
  const next = sorted.find((r) => r.pages[0] > page);
  const end = next ? next.pages[0] - 1 : page;
  return [...sorted, { title, kind, pages: [page, end] as [number, number] }].sort(
    (a, b) => a.pages[0] - b.pages[0],
  );
}

/** Merge row `i` into the row before it (its pages join the previous unit). Pure. */
export function mergeOutlineRow(rows: readonly OutlineEditRow[], i: number): OutlineEditRow[] {
  if (i <= 0 || i >= rows.length) return [...rows];
  const prev = rows[i - 1]!;
  const cur = rows[i]!;
  const out = [...rows];
  out.splice(i - 1, 2, {
    ...prev,
    pages: [Math.min(prev.pages[0], cur.pages[0]), Math.max(prev.pages[1], cur.pages[1])],
  });
  return out;
}
