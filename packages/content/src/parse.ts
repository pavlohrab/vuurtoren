/**
 * Parser for grammar topic pages (`grammar/<lang>/<id>.md`). Self-contained on purpose: the
 * build script (scripts/generate.ts) runs this file directly with Node's type stripping, so it
 * must not import anything at runtime.
 *
 * A page is a front-matter block of `key: value` lines (values are plain strings or `[a, b]`
 * lists) followed by Markdown with `## Explanation`, `## Examples` and `## Common mistakes`.
 * Example lines read `- Dutch sentence with **marks**. | English translation.`
 * The Explanation may hold a `### Pattern` subsection (a list of pattern lines), parsed into
 * `pattern` so a screen can show it as a box.
 *
 * Optional curriculum keys: `group` (one of GRAMMAR_GROUPS) and `order` (position on the
 * suggested learning path, a positive integer).
 */

export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
export const CEFR_LEVELS: readonly CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

/** Curriculum groups, in the order a learner meets them. */
export const GRAMMAR_GROUPS = [
  { id: "words", title: "Spelling & word building" },
  { id: "word-order", title: "Word order" },
  { id: "verbs", title: "Verbs" },
  { id: "infinitives", title: "Infinitives & participles" },
  { id: "nouns", title: "Nouns & articles" },
  { id: "pronouns", title: "Pronouns" },
  { id: "adjectives", title: "Adjectives & adverbs" },
  { id: "clauses", title: "Sentences & clauses" },
  { id: "small-words", title: "Small words" },
  { id: "numbers", title: "Numbers & time" },
  { id: "style", title: "Register & variation" },
] as const;
export type GrammarGroup = (typeof GRAMMAR_GROUPS)[number]["id"];

/** One `## Heading` section of a topic page. */
export interface TopicSection {
  /** Slug of the heading ("explanation", "examples", "common-mistakes"). */
  id: string;
  title: string;
  /** Markdown of the section without its heading. */
  markdown: string;
}

/** One line of the Examples section. `nl` keeps its `**bold**` marks. */
export interface TopicExample {
  nl: string;
  en: string;
}

export interface GrammarTopic {
  /** File name without .md; also the id the NLP detectors use when `detects` contains it. */
  id: string;
  lang: string;
  title: string;
  level: CefrLevel;
  /** One sentence for lists, spotlights and the inspector. */
  summary: string;
  /** Curriculum group (see GRAMMAR_GROUPS); undefined on pages that do not set one. */
  group?: GrammarGroup;
  /** Position on the suggested learning path (1 = first); undefined if not set. */
  order?: number;
  /** Lines of the `### Pattern` box in the Explanation (Markdown), empty if there is none. */
  pattern: string[];
  /** Detector topic ids (server `vuurtoren_nlp.grammar.TOPICS`) whose hits belong to this page. */
  detects: string[];
  /** Exercise kinds (`ExerciseKind` in @app/core) that train this topic. */
  practice: string[];
  /** Ids of related topic pages (may name pages that do not exist yet). */
  related: string[];
  /** The page body (everything after the front matter), Markdown. */
  body: string;
  sections: TopicSection[];
  examples: TopicExample[];
}

/** Error with the file name, so a broken page fails the build with a clear message. */
class TopicParseError extends Error {
  override readonly name = "TopicParseError";
}

const LIST_KEYS = new Set(["detects", "practice", "related"]);
const REQUIRED = ["id", "title", "level", "summary"] as const;

/** URL-style slug of a heading: "Common mistakes" -> "common-mistakes". */
function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseValue(raw: string): string | string[] {
  const v = raw.trim();
  if (v.startsWith("[") && v.endsWith("]")) {
    return v
      .slice(1, -1)
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return v;
}

/**
 * Parse one topic page.
 * @param source the file's text
 * @param file file name, used for the id check and error messages (e.g. "inversion.md")
 * @param lang language of the page ("nl")
 */
export function parseTopic(source: string, file: string, lang: string): GrammarTopic {
  const text = source.replace(/\r\n?/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!m) throw new TopicParseError(`${file}: missing front matter`);
  // Raw values first: an indented line continues the previous value (Prettier wraps long
  // front-matter lines that way).
  const raw: [string, string][] = [];
  for (const line of (m[1] ?? "").split("\n")) {
    if (!line.trim()) continue;
    const last = raw[raw.length - 1];
    if (/^\s/.test(line) && last) {
      last[1] += ` ${line.trim()}`;
      continue;
    }
    const at = line.indexOf(":");
    if (at < 1) throw new TopicParseError(`${file}: bad front-matter line "${line}"`);
    raw.push([line.slice(0, at).trim(), line.slice(at + 1)]);
  }
  const meta: Record<string, string | string[]> = {};
  for (const [k, v] of raw) meta[k] = parseValue(v);
  for (const k of REQUIRED) {
    if (typeof meta[k] !== "string" || !meta[k]) {
      throw new TopicParseError(`${file}: front matter needs "${k}"`);
    }
  }
  const list = (k: string): string[] => {
    const v = meta[k];
    if (v === undefined) return [];
    if (!Array.isArray(v) || !LIST_KEYS.has(k)) {
      throw new TopicParseError(`${file}: "${k}" must be a [list]`);
    }
    return v;
  };
  const id = meta["id"] as string;
  const expected = file.replace(/^.*\//, "").replace(/\.md$/, "");
  if (id !== expected)
    throw new TopicParseError(`${file}: id "${id}" does not match the file name`);
  const level = meta["level"] as CefrLevel;
  if (!CEFR_LEVELS.includes(level)) throw new TopicParseError(`${file}: unknown level "${level}"`);

  let group: GrammarGroup | undefined;
  if (meta["group"] !== undefined) {
    const g = meta["group"];
    if (typeof g !== "string" || !GRAMMAR_GROUPS.some((x) => x.id === g)) {
      throw new TopicParseError(`${file}: unknown group "${String(g)}"`);
    }
    group = g as GrammarGroup;
  }
  let order: number | undefined;
  if (meta["order"] !== undefined) {
    order = Number(meta["order"]);
    if (!Number.isInteger(order) || order < 1) {
      throw new TopicParseError(`${file}: order must be a positive integer`);
    }
  }

  const body = (m[2] ?? "").trim();
  const sections: TopicSection[] = [];
  for (const part of body.split(/^## /m).slice(1)) {
    const nl = part.indexOf("\n");
    const title = (nl < 0 ? part : part.slice(0, nl)).trim();
    sections.push({ id: slug(title), title, markdown: nl < 0 ? "" : part.slice(nl + 1).trim() });
  }
  const examples: TopicExample[] = [];
  for (const line of (sections.find((s) => s.id === "examples")?.markdown ?? "").split("\n")) {
    const ex = /^[-*]\s+(.+?)\s+\|\s+(.+)$/.exec(line.trim());
    if (ex) examples.push({ nl: ex[1] ?? "", en: ex[2] ?? "" });
  }

  const pattern: string[] = [];
  const expl = sections.find((s) => s.id === "explanation")?.markdown ?? "";
  const pat = /^### Pattern[^\n]*\n([\s\S]*?)(?=^### |(?![\s\S]))/m.exec(expl);
  for (const line of (pat?.[1] ?? "").split("\n")) {
    const item = /^[-*]\s+(.+)$/.exec(line.trim());
    if (item) pattern.push(item[1] ?? "");
  }

  return {
    id,
    lang,
    title: meta["title"] as string,
    level,
    summary: meta["summary"] as string,
    ...(group ? { group } : {}),
    ...(order ? { order } : {}),
    pattern,
    detects: list("detects"),
    practice: list("practice"),
    related: list("related"),
    body,
    sections,
    examples,
  };
}
