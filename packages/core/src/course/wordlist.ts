/**
 * Word list and reading-text extraction from blocks (pure). The word list of a book usually
 * has one entry per line, nouns with their article ("de boodschap", "boodschap, de"), verbs
 * in the infinitive, sometimes several columns whose lines the OCR joined.
 */
import { extractNumber } from "./deckmap.js";
import type { Block, Unit, UnitWord } from "./types.js";
import { UNIT_WORD_SRC } from "./vocab.js";

/** A section label that names a unit ("Thema 3", "Unit 3", "Lektion 3"). */
const UNIT_LABEL_RE = new RegExp(String.raw`^${UNIT_WORD_SRC}\s+\d`, "iu");

const ARTICLE = /^(de|het|een)\s+/i;
const TRAILING_ARTICLE = /^(.+?),\s*(de|het)\b.*$/i;
/** "achternaam (de)", "dier (hef)" (OCR), "Engels (het)", "aanbod (het/de)": the article in brackets. */
const BRACKET_ARTICLE = /^(.+?)\s*[([{]\s*(de|het|hef|hel|dc)\b[^)\]}]*[)\]}]?\s*$/i;
const OCR_ARTICLE: Record<string, string> = { hef: "het", hel: "het", dc: "de" };
const ENTRY = /^[\p{L}][\p{L}'’.-]*(?:\s+[\p{L}'’.-]+){0,3}$/u;

/** Parse one word-list line into an entry, or null for headings, numbers and sentences. */
export function parseWordLine(raw: string): UnitWord | null {
  let line = raw
    .trim()
    .replace(/^[•·*\-–]\s*/, "")
    .replace(/\s{2,}.*$/, "");
  if (!line || /\d/.test(line) || line.length > 40) return null;
  let article: string | undefined;
  const bracket = BRACKET_ARTICLE.exec(line);
  if (bracket) {
    line = bracket[1] ?? line;
    const a = (bracket[2] ?? "").toLowerCase();
    article = OCR_ARTICLE[a] ?? a;
  }
  const trailing = TRAILING_ARTICLE.exec(line);
  if (trailing) {
    line = trailing[1] ?? line;
    article = (trailing[2] ?? "").toLowerCase();
  }
  const lead = ARTICLE.exec(line);
  if (lead) {
    const a = (lead[1] ?? "").toLowerCase();
    if (a !== "een") article ??= a;
    line = line.slice(lead[0].length);
  }
  line = line.replace(/[.,;:]+$/, "").trim();
  if (!ENTRY.test(line) || line.split(/\s+/).length > 4) return null;
  // Sentences (terminal punctuation, many words) are not entries.
  if (/[!?]$/.test(raw.trim())) return null;
  const word: UnitWord = { lemma: line.toLowerCase(), source: "wordlist" };
  if (article) word.article = article;
  return word;
}

/** Entries of a block of word-list text, deduplicated, in order. */
export function parseWordList(text: string): UnitWord[] {
  const seen = new Set<string>();
  const out: UnitWord[] = [];
  // Re-join entries the layout hyphenated across lines ("assistent in oplei-" / "ding").
  const lines = text.replace(/-\n(?=\p{Ll})/gu, "").split("\n");
  for (const line of lines) {
    const w = parseWordLine(line);
    if (!w || seen.has(w.lemma)) continue;
    seen.add(w.lemma);
    out.push(w);
  }
  return out;
}

/** Unit number named by a word-list / transcript section label ("Thema 3"). */
function sectionUnitNumber(label: string | undefined): number | null {
  const m = /(\d{1,2})/.exec(label ?? "");
  return m ? Number(m[1]) : null;
}

/** Word list per theme unit number: the word-list blocks labelled "Thema N". */
export function unitWordLists(
  blocks: readonly Block[],
  units: readonly Unit[],
): Map<number, UnitWord[]> {
  const out = new Map<number, UnitWord[]>();
  const themeNumber = new Map(
    units
      .filter((u) => u.kind === "theme")
      .map((u) => [extractNumber(u.title) ?? u.n, u.n] as const),
  );
  for (const b of blocks) {
    if (b.kind !== "wordlist") continue;
    const num = sectionUnitNumber(b.label);
    const unitN = num === null ? undefined : (themeNumber.get(num) ?? num);
    if (unitN === undefined) continue;
    const words = [...(out.get(unitN) ?? []), ...parseWordList(b.text)];
    out.set(
      unitN,
      words.filter((w, i) => words.findIndex((x) => x.lemma === w.lemma) === i),
    );
  }
  return out;
}

const wordsIn = (s: string) => s.match(/\p{L}+/gu)?.length ?? 0;
/** A paragraph of running prose: long, several sentences, not a list of short lines. */
function isProse(par: string): boolean {
  const lines = par.split("\n").filter(Boolean);
  const avg = wordsIn(par) / Math.max(1, lines.length);
  return wordsIn(par) >= 35 && (par.match(/[.!?]/g)?.length ?? 0) >= 3 && avg >= 5;
}

export interface ReadingText {
  title: string;
  text: string;
  kind: "text" | "transcript";
  page: number;
}

/** Re-join lines of a paragraph (OCR line breaks inside sentences). */
function reflow(par: string): string {
  return par
    .replace(/-\n(?=\p{Ll})/gu, "")
    .replace(/\n/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Reading texts of a unit: prose paragraphs inside its exercise/other blocks (kind "text") and
 * the transcript sections for the unit (kind "transcript"). When the unit has blocks of kind
 * "text" (marked by hand, e.g. in a corrected course pack), exactly those are its reading texts.
 * Prose is only guessed in themes (and units of kind "other"): a grammar appendix explains and
 * drills, the word list and transcripts units hold no reading texts of their own.
 */
export function readingTexts(blocks: readonly Block[], unit: Unit): ReadingText[] {
  const themeNumber = extractNumber(unit.title) ?? unit.n;
  const out: ReadingText[] = [];
  const inUnit = (b: Block) => b.page >= unit.pages[0] && b.page <= unit.pages[1];
  const explicit = blocks.some((b) => b.kind === "text" && inUnit(b));
  for (const b of blocks) {
    if (b.kind === "transcript") {
      const num = sectionUnitNumber(b.label);
      if (!b.label || !UNIT_LABEL_RE.test(b.label) || num !== themeNumber) continue;
      const text = reflow(b.text);
      if (wordsIn(text) >= 20) {
        out.push({
          title: `${unit.title} · luisterteksten`,
          text: b.text
            .split(/\n{2,}/)
            .map(reflow)
            .join("\n\n"),
          kind: "transcript",
          page: b.page,
        });
      }
      continue;
    }
    if (!inUnit(b)) continue;
    if (explicit) {
      if (b.kind !== "text") continue;
      out.push({
        title: `${unit.title} · ${b.label ?? `blz. ${b.page}`}`,
        text: b.text
          .split(/\n{2,}/)
          .map(reflow)
          .filter(Boolean)
          .join("\n\n"),
        kind: "text",
        page: b.page,
      });
      continue;
    }
    if (b.kind !== "exercise" && b.kind !== "other") continue;
    if (unit.kind !== "theme" && unit.kind !== "other") continue;
    const prose = b.text
      .split(/\n{2,}/)
      .filter(isProse)
      .map(reflow);
    if (prose.length === 0) continue;
    out.push({
      title: `${unit.title} · ${b.label ?? `blz. ${b.page}`}`,
      text: prose.join("\n\n"),
      kind: "text",
      page: b.page,
    });
  }
  return out;
}
