import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { type CefrLevel, type GrammarTopic, grammarTopic, topicsByLevel } from "@app/content";
import { Chip, EmptyState, Skeleton } from "@app/ui";
import { CreateStoryButton } from "./StoryDialog.js";
import { PageHeader } from "../shell/PageHeader.js";
import { useServices } from "../services/context.js";
import type { GrammarOverview, TopicExamples } from "../services/types.js";
import { usePageHeader } from "../shell/ShellContext.js";
import { Markdown, inline } from "./Markdown.js";
import "./grammar.css";

export const LEVEL_LABEL: Record<CefrLevel, string> = {
  A1: "Beginner",
  A2: "Elementary",
  B1: "Intermediate",
  B2: "Upper intermediate",
  C1: "Advanced",
  C2: "Proficient",
};

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

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function useGrammarOverview() {
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

/** /grammar: every topic, grouped by level, with how often it occurs in the Library. */
export function Grammar() {
  const overview = useGrammarOverview();
  const o = overview.data;
  const groups = topicsByLevel();
  return (
    <div className="page page--narrow grammar">
      <PageHeader
        title="Grammar"
        lede="Short topics with examples from what you read. The numbers show how often each one occurs in your Library."
        actions={
          <Link to="/practice" className="k-btn k-btn--secondary">
            Practice
          </Link>
        }
      />
      {o && o.missing > 0 ? (
        <p className="k-hint grammar-note" role="status">
          {plural(o.missing, "text")} could not be checked: the language server is unreachable.
        </p>
      ) : null}
      {o && o.texts === 0 && o.missing === 0 ? (
        <p className="k-hint grammar-note">
          Open a text from your Library to see which topics it uses.
        </p>
      ) : null}
      {groups.map(({ level, topics }) => (
        <section key={level} className="grammar-level" aria-labelledby={`level-${level}`}>
          <h2 id={`level-${level}`} className="grammar-level-title">
            <span className="grammar-level-code">{level}</span> {LEVEL_LABEL[level]}
          </h2>
          <ul className="grammar-list">
            {topics.map((t) => {
              const count = topicCount(t, o);
              return (
                <li key={t.id}>
                  <Link to="/grammar/$topic" params={{ topic: t.id }} className="grammar-row">
                    <span className="grammar-row-main">
                      <span className="grammar-row-title">{t.title}</span>
                      <span className="grammar-row-summary">{inline(t.summary)}</span>
                    </span>
                    <span className="grammar-row-count">
                      {overview.isPending ? (
                        <Skeleton style={{ width: 48, height: 14 }} />
                      ) : count && count.hits > 0 ? (
                        <span title={`In ${plural(count.texts, "text")} of your Library`}>
                          {count.hits}
                          <span className="sr-only"> times in your texts</span>
                        </span>
                      ) : t.detects.length ? (
                        <span className="grammar-row-zero" aria-label="Not in your texts yet">
                          –
                        </span>
                      ) : null}
                    </span>
                    <ChevronRight size={16} aria-hidden className="grammar-row-chevron" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Route component for /grammar/$topic. */
export function GrammarTopicRoute() {
  const { topic } = useParams({ from: "/grammar/$topic" });
  return <GrammarTopicPage key={topic} topicId={topic} />;
}

/** One topic: explanation, examples from your texts, then Tatoeba, mistakes and Practise. */
export function GrammarTopicPage({ topicId }: { topicId: string }) {
  const services = useServices();
  const topic = grammarTopic(topicId);
  usePageHeader(topic?.title ?? "Grammar");
  const examples = useQuery({
    queryKey: ["grammar", "examples", topicId],
    queryFn: () => services.grammarExamples(topic?.detects ?? [], { limit: 8 }),
    enabled: !!topic && topic.detects.length > 0,
    staleTime: 60_000,
  });
  const overview = useGrammarOverview();

  if (!topic) {
    return (
      <div className="page page--narrow">
        <EmptyState
          title="This topic was not found"
          description="It may have been renamed."
          action={
            <Link to="/grammar" className="k-btn k-btn--primary">
              All grammar topics
            </Link>
          }
        />
      </div>
    );
  }
  const section = (id: string) => topic.sections.find((s) => s.id === id);
  const explanation = section("explanation");
  const mistakes = section("common-mistakes");
  const count = topicCount(topic, overview.data);
  const related = topic.related.map((id) => grammarTopic(id)).filter((t): t is GrammarTopic => !!t);
  const canPractise = topic.practice.length > 0 && topic.detects.length > 0;

  return (
    <div className="page page--narrow grammar grammar-topic">
      <Link to="/grammar" className="grammar-back">
        <ArrowLeft size={14} aria-hidden /> Grammar
      </Link>
      <div className="grammar-topic-head">
        <h1>{topic.title}</h1>
        <Chip tone="accent" title={LEVEL_LABEL[topic.level]}>
          {topic.level}
        </Chip>
      </div>
      <p className="page-lede">{inline(topic.summary)}</p>
      <div className="grammar-actions">
        {canPractise ? (
          <Link
            to="/grammar/$topic/practice"
            params={{ topic: topic.id }}
            className="k-btn k-btn--primary"
          >
            Practise
          </Link>
        ) : null}
        <CreateStoryButton preset={{ grammarTopic: topic.id }} />
        {count && count.hits > 0 ? (
          <span className="k-hint">
            Seen {plural(count.hits, "time")} in {plural(count.texts, "text")} of your Library
          </span>
        ) : null}
      </div>

      {explanation ? (
        <section className="grammar-section grammar-prose" aria-labelledby="g-explanation">
          <h2 id="g-explanation">Explanation</h2>
          <Markdown source={explanation.markdown} />
        </section>
      ) : null}

      {topic.examples.length ? (
        <section className="grammar-section" aria-labelledby="g-examples">
          <h2 id="g-examples">Examples</h2>
          <ul className="grammar-examples">
            {topic.examples.map((ex, i) => (
              <li key={i}>
                <span className="grammar-example-nl" lang="nl">
                  {inline(ex.nl)}
                </span>
                <span className="grammar-example-en">{ex.en}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {topic.detects.length ? (
        <TopicExamplesSection
          loading={examples.isPending}
          error={examples.isError}
          data={examples.data}
          onRetry={() => void examples.refetch()}
        />
      ) : null}

      {mistakes ? (
        <section className="grammar-section grammar-prose" aria-labelledby="g-mistakes">
          <h2 id="g-mistakes">Common mistakes</h2>
          <Markdown source={mistakes.markdown} />
        </section>
      ) : null}

      {related.length ? (
        <section className="grammar-section" aria-labelledby="g-related">
          <h2 id="g-related">Related topics</h2>
          <ul className="grammar-related">
            {related.map((r) => (
              <li key={r.id}>
                <Link to="/grammar/$topic" params={{ topic: r.id }} className="grammar-chip-link">
                  {r.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function TopicExamplesSection({
  loading,
  error,
  data,
  onRetry,
}: {
  loading: boolean;
  error: boolean;
  data: TopicExamples | undefined;
  onRetry: () => void;
}) {
  return (
    <>
      <section className="grammar-section" aria-labelledby="g-yours" aria-busy={loading}>
        <h2 id="g-yours">In your texts</h2>
        {loading ? (
          <div className="stack" style={{ gap: 8 }}>
            <Skeleton style={{ height: 20 }} />
            <Skeleton style={{ height: 20, width: "80%" }} />
          </div>
        ) : error ? (
          <p className="error-text" role="alert">
            Examples could not be loaded.{" "}
            <button type="button" className="link-button" onClick={onRetry}>
              Retry
            </button>
          </p>
        ) : data && data.library.length ? (
          <ul className="grammar-found">
            {data.library.map((ex, i) => (
              <li key={`${ex.textId}-${i}`}>
                <p className="grammar-found-sentence" lang="nl">
                  <MarkedSentence text={ex.sentence} marks={ex.marks} />
                </p>
                <p className="grammar-found-meta">
                  <span>{ex.note}</span>
                  <span aria-hidden> · </span>
                  <Link to="/read/$textId" params={{ textId: ex.textId }}>
                    {ex.title}
                  </Link>
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="k-hint">Not in your texts yet. It will show up here once you read it.</p>
        )}
      </section>

      {!loading && !error && data ? (
        <section className="grammar-section" aria-labelledby="g-tatoeba">
          <h2 id="g-tatoeba">More examples</h2>
          {data.tatoeba.length ? (
            <>
              <ul className="grammar-found">
                {data.tatoeba.map((ex, i) => (
                  <li key={i}>
                    <p className="grammar-found-sentence" lang="nl">
                      <MarkedSentence text={ex.text} marks={ex.marks} />
                    </p>
                    <p className="grammar-found-meta">{ex.translation}</p>
                  </li>
                ))}
              </ul>
              <p className="k-hint grammar-credit">
                Sentences from{" "}
                <a href="https://tatoeba.org" target="_blank" rel="noreferrer">
                  Tatoeba
                </a>{" "}
                (CC BY 2.0 FR).
              </p>
            </>
          ) : (
            <p className="k-hint">
              {data.tatoebaUnavailable
                ? "Example sentences are unavailable: the language server is unreachable or its sentence database is not built."
                : "No example sentences found yet."}
            </p>
          )}
        </section>
      ) : null}
    </>
  );
}
