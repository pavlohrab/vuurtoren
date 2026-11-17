/**
 * Parser for grammar topic pages (`grammar/<lang>/<id>.md`). Self-contained on purpose: the
 * build script (scripts/generate.ts) runs this file directly with Node's type stripping, so it
 * must not import anything at runtime.
 *
 * A page is a front-matter block of `key: value` lines (values are plain strings or `[a, b]`
 * lists) followed by Markdown with `## Explanation`, `## Examples` and `## Common mistakes`.
 * Example lines read `- Dutch sentence with **marks**. | English translation.`
 */

export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
export const CEFR_LEVELS: readonly CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

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
  /** Detector topic ids (server `kenning_nlp.grammar.TOPICS`) whose hits belong to this page. */
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
export class TopicParseError extends Error {
  override readonly name = "TopicParseError";
}

const LIST_KEYS = new Set(["detects", "practice", "related"]);
const REQUIRED = ["id", "title", "level", "summary"] as const;

/** URL-style slug of a heading: "Common mistakes" -> "common-mistakes". */
export function slug(s: string): string {
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
  const meta: Record<string, string | string[]> = {};
  for (const line of (m[1] ?? "").split("\n")) {
    if (!line.trim()) continue;
    const at = line.indexOf(":");
    if (at < 1) throw new TopicParseError(`${file}: bad front-matter line "${line}"`);
    meta[line.slice(0, at).trim()] = parseValue(line.slice(at + 1));
  }
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

  return {
    id,
    lang,
    title: meta["title"] as string,
    level,
    summary: meta["summary"] as string,
    detects: list("detects"),
    practice: list("practice"),
    related: list("related"),
    body,
    sections,
    examples,
  };
}
