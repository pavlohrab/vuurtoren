/** Grammar topics a unit teaches, ranked against the whole course. */
import { type Block, type Unit, readingTexts } from "@app/core";
import { topicForHit } from "@app/content";
import type { CourseServices, UnitGrammarTopic } from "../courseTypes.js";
import { type CourseContext, unitSentences } from "./context.js";

export function createCourseGrammar(ctx: CourseContext) {
  const { deps, repo, courseOrThrow } = ctx;

  const grammarCache = new Map<string, UnitGrammarTopic[]>();
  const baselineCache = new Map<string, Promise<Map<string, number>>>();

  /** Sentences that show each grammar topic, per topic id, with a sample sentence. */
  async function topicCounts(
    lang: string,
    sentences: readonly string[],
  ): Promise<Map<string, { count: number; example: string }>> {
    const hits = await (await deps.nlp()).grammar("nl", [...sentences]);
    const counts = new Map<string, { count: number; example: string }>();
    hits.forEach((list, i) => {
      for (const id of new Set(list.map((h) => topicForHit(h.topic, lang)?.id ?? ""))) {
        if (!id) continue;
        const cur = counts.get(id) ?? { count: 0, example: sentences[i] ?? "" };
        cur.count++;
        counts.set(id, cur);
      }
    });
    return counts;
  }

  /** How often each topic occurs in a sample of the whole course (share of sentences). */
  function courseBaseline(course: { id: string; lang: string; units: Unit[] }, blocks: Block[]) {
    let p = baselineCache.get(course.id);
    if (!p) {
      p = (async () => {
        const themes = course.units.filter((u) => u.kind === "theme");
        const per = Math.max(10, Math.floor(400 / Math.max(1, themes.length)));
        const sample = themes.flatMap((u) => unitSentences(blocks, u).slice(0, per));
        const counts = await topicCounts(course.lang, sample);
        return new Map([...counts].map(([id, c]) => [id, c.count / Math.max(1, sample.length)]));
      })();
      baselineCache.set(course.id, p);
      p.catch(() => baselineCache.delete(course.id));
    }
    return p;
  }

  /**
   * Grammar topics of a unit, ranked by how much more the unit uses them than the course does
   * (so "plural nouns" and "questions", which every unit has, do not crowd out what the unit
   * teaches), with at least three sentences each.
   */
  async function unitGrammar(courseId: string, n: number): Promise<UnitGrammarTopic[]> {
    const cacheKey = `${courseId}:${n}`;
    const cached = grammarCache.get(cacheKey);
    if (cached) return cached;
    const course = await courseOrThrow(courseId);
    const unit = course.units.find((u) => u.n === n);
    if (!unit || course.lang !== "nl") return [];
    const blocks = await repo.courseBlocks(courseId);
    const sentences = [
      ...readingTexts(blocks, unit).flatMap((t) => t.text.split(/(?<=[.!?])\s+/u)),
      ...unitSentences(blocks, unit),
    ]
      .filter((x) => (x.match(/\p{L}+/gu)?.length ?? 0) >= 4)
      .slice(0, 400);
    if (sentences.length === 0) return [];
    let counts: Map<string, { count: number; example: string }>;
    let baseline: Map<string, number>;
    try {
      [counts, baseline] = await Promise.all([
        topicCounts(course.lang, sentences),
        unit.kind === "theme" ? courseBaseline(course, blocks) : Promise.resolve(new Map()),
      ]);
    } catch {
      // Grammar topics of a unit are optional; an outage shows in the degraded indicator.
      return [];
    }
    const lift = (id: string, c: number) => {
      const rate = c / sentences.length;
      const base = baseline.get(id);
      return base ? rate / base : 1;
    };
    const out: UnitGrammarTopic[] = [...counts]
      .filter(([, c]) => c.count >= 3)
      .sort(
        (a, b) =>
          lift(b[0], b[1].count) * Math.sqrt(b[1].count) -
          lift(a[0], a[1].count) * Math.sqrt(a[1].count),
      )
      .flatMap(([id, c]) => {
        const t = topicForHit(id, course.lang);
        return t
          ? [
              {
                topicId: t.id,
                title: t.title,
                level: t.level,
                summary: t.summary,
                count: c.count,
                ...(c.example ? { example: c.example } : {}),
              },
            ]
          : [];
      })
      .slice(0, 6);
    grammarCache.set(cacheKey, out);
    return out;
  }

  return { unitGrammar } satisfies Partial<CourseServices>;
}
