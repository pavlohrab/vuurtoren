import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { type CefrLevel, GRAMMAR_GROUPS, type GrammarTopic } from "@app/content";
import { useServices } from "../services/context.js";
import type { GrammarOverview } from "../services/types.js";

export const LEVEL_LABEL: Record<CefrLevel, string> = {
  A1: "Beginner",
  A2: "Elementary",
  B1: "Intermediate",
  B2: "Upper intermediate",
  C1: "Advanced",
  C2: "Proficient",
};

/** One line per level on the learning path: what that stretch of the path covers. */
export const LEVEL_LINE: Record<CefrLevel, string> = {
  A1: "First sentences: the present tense, the verb in second place, de and het, pronouns and numbers.",
  A2: "The past and the future, separable verbs, adjective endings and clauses with the verb at the end.",
  B1: "Where niet goes, relative clauses, te-infinitives, er, the passive and the little words that add tone.",
  B2: "Verb clusters, the impersonal passive, participles as adjectives and linking adverbs.",
  C1: "Long phrases before a noun, conditions without als, register and the Dutch of Flanders.",
  C2: "",
};

/** Title of a curriculum group ("Word order"), or undefined. */
export function groupTitle(group: GrammarTopic["group"]): string | undefined {
  return GRAMMAR_GROUPS.find((g) => g.id === group)?.title;
}

/** Hits of a topic page: the sum over the detectors it lists. */
export function topicCount(
  topic: GrammarTopic,
  overview: GrammarOverview | undefined,
): { hits: number; texts: number } | null {
  if (!overview) return null;
  let hits = 0;
  let texts = 0;
  for (const d of topic.detects) {
    hits += overview.counts[d] ?? 0;
    texts = Math.max(texts, overview.textCounts[d] ?? 0);
  }
  return { hits, texts };
}

export function useGrammarOverview() {
  const services = useServices();
  return useQuery({
    queryKey: ["grammar", "overview"],
    queryFn: () => services.grammarOverview(),
    staleTime: 60_000,
  });
}

/** `text` with the [start, end) spans in `marks` highlighted. */
export function MarkedSentence({ text, marks }: { text: string; marks: [number, number][] }) {
  const parts: ReactNode[] = [];
  let at = 0;
  const sorted = [...marks].sort((a, b) => a[0] - b[0]);
  for (const [s, e] of sorted) {
    if (s < at || e > text.length || s >= e) continue;
    if (s > at) parts.push(text.slice(at, s));
    parts.push(
      <mark key={s} className="grammar-mark">
        {text.slice(s, e)}
      </mark>,
    );
    at = e;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}
