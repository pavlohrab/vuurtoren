/**
 * Learning content shipped with the app. For now: grammar topic pages (packages/content/grammar),
 * parsed at build time into plain data (see scripts/generate.ts).
 */
import { TOPICS } from "./generated/grammar.js";
import {
  CEFR_LEVELS,
  GRAMMAR_GROUPS,
  type CefrLevel,
  type GrammarGroup,
  type GrammarTopic,
} from "./parse.js";

export { CEFR_LEVELS, GRAMMAR_GROUPS, TopicParseError, parseTopic, slug } from "./parse.js";
export type { CefrLevel, GrammarGroup, GrammarTopic, TopicExample, TopicSection } from "./parse.js";

/** Every grammar topic of `lang`, ordered by level, then title. */
export function grammarTopics(lang = "nl"): GrammarTopic[] {
  return TOPICS.filter((t) => t.lang === lang).sort(
    (a, b) =>
      CEFR_LEVELS.indexOf(a.level) - CEFR_LEVELS.indexOf(b.level) || a.title.localeCompare(b.title),
  );
}

/** One topic page, or undefined. */
export function grammarTopic(id: string, lang = "nl"): GrammarTopic | undefined {
  return TOPICS.find((t) => t.id === id && t.lang === lang);
}

/** Topics grouped by level, in level order (levels without topics are left out). */
export function topicsByLevel(lang = "nl"): { level: CefrLevel; topics: GrammarTopic[] }[] {
  const all = grammarTopics(lang);
  return CEFR_LEVELS.map((level) => ({
    level,
    topics: all.filter((t) => t.level === level),
  })).filter((g) => g.topics.length > 0);
}

/**
 * The page that explains a detector hit: the page with the same id if it lists the detector,
 * else the first page (by level) that does.
 */
export function topicForHit(detector: string, lang = "nl"): GrammarTopic | undefined {
  const own = grammarTopic(detector, lang);
  if (own?.detects.includes(detector)) return own;
  return grammarTopics(lang).find((t) => t.detects.includes(detector));
}

/** Topics on the suggested learning path: by `order`, then level and title (unordered last). */
export function curriculum(lang = "nl"): GrammarTopic[] {
  const pos = (t: GrammarTopic) => t.order ?? Number.MAX_SAFE_INTEGER;
  return [...grammarTopics(lang)].sort((a, b) => pos(a) - pos(b));
}

/** Topics grouped by curriculum group, in group order; each group in curriculum order. */
export function topicsByGroup(
  lang = "nl",
): { group: GrammarGroup; title: string; topics: GrammarTopic[] }[] {
  const all = curriculum(lang);
  return GRAMMAR_GROUPS.map((g) => ({
    group: g.id,
    title: g.title,
    topics: all.filter((t) => t.group === g.id),
  })).filter((g) => g.topics.length > 0);
}
