import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { grammarTopic, grammarTopics, parseTopic, topicForHit, topicsByLevel } from "./index.js";

/** Detector topic ids, read from the NLP service source (the single source of truth). */
function detectorTopics(): Set<string> {
  const src = readFileSync(
    join(import.meta.dirname, "../../../server/nlp/src/kenning_nlp/grammar.py"),
    "utf8",
  );
  const block = /TOPICS: frozenset\[str\] = frozenset\(\s*\{([\s\S]*?)\}/.exec(src)?.[1] ?? "";
  return new Set([...block.matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]!));
}

/** Exercise kinds that have a generator in @app/core (packages/core/src/practice/types.ts). */
const EXERCISE_KINDS = new Set([
  "meaning-choice",
  "word-choice",
  "cloze-choice",
  "cloze-typed",
  "gender",
  "separable",
  "perfect",
  "verb-form",
  "adjective-e",
  "scramble",
  "dictation",
]);

describe("grammar topics", () => {
  const topics = grammarTopics("nl");
  const ids = new Set(topics.map((t) => t.id));

  it("has a page for every detector topic", () => {
    const detectors = detectorTopics();
    expect(detectors.size).toBeGreaterThan(20);
    for (const d of detectors) expect(ids, d).toContain(d);
    // ...and every hit can be explained by some page.
    for (const d of detectors) expect(topicForHit(d)?.detects, d).toContain(d);
  });

  it("only names known detectors and exercise kinds", () => {
    const detectors = detectorTopics();
    for (const t of topics) {
      for (const d of t.detects) expect(detectors, `${t.id} detects ${d}`).toContain(d);
      for (const k of t.practice) expect(EXERCISE_KINDS, `${t.id} practice ${k}`).toContain(k);
    }
  });

  it("every page has a summary, an explanation, examples and mistakes", () => {
    for (const t of topics) {
      expect(t.summary.length, t.id).toBeGreaterThan(20);
      expect(t.sections.map((s) => s.id)).toEqual(["explanation", "examples", "common-mistakes"]);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(4);
      for (const ex of t.examples) {
        expect(ex.nl, t.id).toMatch(/\*\*.+\*\*/);
        expect(ex.en.length, t.id).toBeGreaterThan(3);
      }
    }
  });

  it("groups by level and looks topics up", () => {
    const groups = topicsByLevel();
    expect(groups.map((g) => g.level)).toEqual(["A1", "A2", "B1"]);
    expect(groups.flatMap((g) => g.topics)).toHaveLength(topics.length);
    expect(grammarTopic("inversion")?.title).toBe("Inversion");
    expect(grammarTopic("nope")).toBeUndefined();
    // The diminutive detector has its own page; de-het borrows its hits.
    expect(topicForHit("diminutives")?.id).toBe("diminutives");
    expect(grammarTopic("de-het")?.detects).toContain("diminutives");
  });
});

describe("parseTopic", () => {
  const page = `---
id: demo
title: Demo
level: A2
summary: A short summary of the demo topic.
detects: [inversion, er]
practice: [scramble]
---

## Explanation

Some **bold** text.

## Examples

- Morgen **ga ik**. | Tomorrow I go.

## Common mistakes

- None.
`;

  it("reads front matter, sections and examples", () => {
    const t = parseTopic(page, "demo.md", "nl");
    expect(t).toMatchObject({
      id: "demo",
      level: "A2",
      detects: ["inversion", "er"],
      practice: ["scramble"],
      related: [],
    });
    expect(t.sections.map((s) => s.title)).toEqual(["Explanation", "Examples", "Common mistakes"]);
    expect(t.examples).toEqual([{ nl: "Morgen **ga ik**.", en: "Tomorrow I go." }]);
    expect(t.body.startsWith("## Explanation")).toBe(true);
  });

  it("rejects broken pages", () => {
    expect(() => parseTopic("no front matter", "x.md", "nl")).toThrow(/front matter/);
    expect(() => parseTopic(page, "other.md", "nl")).toThrow(/file name/);
    expect(() => parseTopic(page.replace("A2", "Z9"), "demo.md", "nl")).toThrow(/level/);
    expect(() => parseTopic(page.replace("title: Demo\n", ""), "demo.md", "nl")).toThrow(/title/);
  });
});
