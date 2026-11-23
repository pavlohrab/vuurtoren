import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GRAMMAR_GROUPS,
  curriculum,
  grammarTopic,
  grammarTopics,
  parseTopic,
  topicForHit,
  topicsByGroup,
  topicsByLevel,
} from "./index.js";

/** Detector topic ids, read from the NLP service source (the single source of truth). */
function detectorTopics(): Set<string> {
  const src = readFileSync(
    join(import.meta.dirname, "../../../server/nlp/src/vuurtoren_nlp/grammar.py"),
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
    expect(groups.map((g) => g.level)).toEqual(["A1", "A2", "B1", "B2", "C1"]);
    expect(groups.flatMap((g) => g.topics)).toHaveLength(topics.length);
    expect(grammarTopic("inversion")?.title).toBe("Inversion");
    expect(grammarTopic("nope")).toBeUndefined();
    // The diminutive detector has its own page; de-het borrows its hits.
    expect(topicForHit("diminutives")?.id).toBe("diminutives");
    expect(grammarTopic("de-het")?.detects).toContain("diminutives");
  });
});

describe("curriculum", () => {
  const topics = grammarTopics("nl");
  const ids = new Set(topics.map((t) => t.id));

  it("every page has a group and a unique order", () => {
    const orders = topics.map((t) => t.order);
    for (const t of topics) {
      expect(t.group, t.id).toBeDefined();
      expect(t.order, t.id).toBeGreaterThan(0);
    }
    expect(new Set(orders).size).toBe(topics.length);
  });

  it("the path starts easy and every level stays in order", () => {
    const path = curriculum();
    expect(path).toHaveLength(topics.length);
    expect(path[0]?.level).toBe("A1");
    const levels = path.map((t) => ["A1", "A2", "B1", "B2", "C1", "C2"].indexOf(t.level));
    for (let i = 1; i < levels.length; i++)
      expect(levels[i]).toBeGreaterThanOrEqual(levels[i - 1]!);
  });

  it("groups cover every topic, in group order", () => {
    const groups = topicsByGroup();
    expect(groups.flatMap((g) => g.topics)).toHaveLength(topics.length);
    const order = GRAMMAR_GROUPS.map((g) => g.id);
    const seen = groups.map((g) => order.indexOf(g.group));
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });

  it("every page lists its sources", () => {
    for (const t of topics) {
      expect(t.sources.length, t.id).toBeGreaterThan(0);
      for (const s of t.sources) {
        expect(s.label.length, t.id).toBeGreaterThan(3);
        expect(s.url, t.id).toMatch(/^https:\/\/\S+$/);
      }
    }
    expect(grammarTopic("hebben-or-zijn")?.sources[0]).toEqual({
      label: "e-ANS 2.3.2.8.iv",
      url: "https://e-ans.ivdnt.org/topics/pid/ans0203020804lingtopic",
    });
  });

  it("related ids point at existing pages and pages have a pattern box", () => {
    for (const t of topics) {
      for (const r of t.related) expect(ids, `${t.id} -> ${r}`).toContain(r);
      expect(t.pattern.length, t.id).toBeGreaterThan(0);
    }
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
    expect(t.group).toBeUndefined();
    expect(t.order).toBeUndefined();
    expect(t.pattern).toEqual([]);
    expect(t.sources).toEqual([]);
  });

  it("reads sources as label | url", () => {
    const withSources = page.replace(
      "practice: [scramble]\n",
      "practice: [scramble]\nsources:\n  [\n    e-ANS 21.3 | https://e-ans.ivdnt.org/x,\n    Taaladvies (dat / wat) | https://taaladvies.net/y,\n  ]\n",
    );
    expect(parseTopic(withSources, "demo.md", "nl").sources).toEqual([
      { label: "e-ANS 21.3", url: "https://e-ans.ivdnt.org/x" },
      { label: "Taaladvies (dat / wat)", url: "https://taaladvies.net/y" },
    ]);
    expect(() =>
      parseTopic(page.replace("practice: [scramble]", "sources: [no url]"), "demo.md", "nl"),
    ).toThrow(/source/);
  });

  it("joins wrapped front-matter lines", () => {
    const wrapped = page.replace("detects: [inversion, er]", "detects:\n  [inversion,\n  er]");
    expect(parseTopic(wrapped, "demo.md", "nl").detects).toEqual(["inversion", "er"]);
  });

  it("reads group, order and the pattern box", () => {
    const withMeta = page
      .replace("level: A2\n", "level: A2\ngroup: verbs\norder: 7\n")
      .replace(
        "Some **bold** text.",
        "Some **bold** text.\n\n### Pattern\n- `a` → b\n- c\n\n### More\n- not this",
      );
    const t = parseTopic(withMeta, "demo.md", "nl");
    expect(t).toMatchObject({ group: "verbs", order: 7, pattern: ["`a` → b", "c"] });
    expect(() =>
      parseTopic(withMeta.replace("group: verbs", "group: nope"), "demo.md", "nl"),
    ).toThrow(/group/);
    expect(() => parseTopic(withMeta.replace("order: 7", "order: x"), "demo.md", "nl")).toThrow(
      /order/,
    );
  });

  it("rejects broken pages", () => {
    expect(() => parseTopic("no front matter", "x.md", "nl")).toThrow(/front matter/);
    expect(() => parseTopic(page, "other.md", "nl")).toThrow(/file name/);
    expect(() => parseTopic(page.replace("A2", "Z9"), "demo.md", "nl")).toThrow(/level/);
    expect(() => parseTopic(page.replace("title: Demo\n", ""), "demo.md", "nl")).toThrow(/title/);
  });
});
