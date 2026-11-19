import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Check, ChevronRight, X } from "lucide-react";
import { type GrammarTopic, curriculum, grammarTopic } from "@app/content";
import { Chip, EmptyState, Skeleton } from "@app/ui";
import { WriteStoryLink, useAIReady } from "../StoryForm.js";
import { PageHeader } from "../../shell/PageHeader.js";
import { useServices } from "../../services/context.js";
import type { TopicExamples } from "../../services/types.js";
import { usePageHeader } from "../../shell/ShellContext.js";
import { Markdown, inline } from "../Markdown.js";
import {
  LEVEL_LABEL,
  MarkedSentence,
  groupTitle,
  topicCount,
  useGrammarOverview,
} from "./GrammarCommon.js";
import { plural } from "../../format.js";
import { ErrorNotice } from "../../shell/ErrorNotice.js";
import "./grammar.css";

/** The Explanation without its `### Pattern` subsection (shown as a box instead). */
function withoutPattern(md: string): string {
  return md.replace(/^### Pattern[^\n]*\n[\s\S]*?(?=^### |(?![\s\S]))/m, "").trim();
}

/**
 * One "Common mistakes" bullet as a ✗/✓ pair: the mistake is everything up to the first
 * sentence end (outside or right after an italic example), the fix is the rest. A bullet with
 * a single sentence has no fix part.
 */
export function splitMistake(line: string): { wrong: string; right: string } {
  const word = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);
  let italic = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    // An underscore opens emphasis at a word start and closes it at a word end (not snake_case).
    if (c === "_" && !(word(line[i - 1]) && word(line[i + 1]))) italic = !italic;
    if (!".?!…".includes(c)) continue;
    let j = i + 1;
    if (italic && line[j] === "_") {
      italic = false;
      j++;
    }
    if (italic || !/\s/.test(line[j] ?? "")) continue;
    const right = line.slice(j).trim();
    if (right) return { wrong: line.slice(0, j).trim(), right };
  }
  return { wrong: line.trim(), right: "" };
}

/** Bullets of a Markdown list (continuation lines joined). */
function bullets(md: string): string[] {
  const out: string[] = [];
  for (const raw of md.split("\n")) {
    const l = raw.trim();
    if (!l) continue;
    if (/^[-*]\s+/.test(l)) out.push(l.replace(/^[-*]\s+/, ""));
    else if (out.length) out[out.length - 1] += ` ${l}`;
  }
  return out;
}

/**
 * What the topic page offers for practice: the topic's exercises when a detector finds its
 * sentences, else AI sentences when a provider is set and the topic supports them, else nothing.
 * AI sentences are only kept when the topic's detector confirms them (packages/ai
 * validateSentence), so AI fill needs a detector and a sentence-based kind (scramble).
 */
export function practiceOffer(topic: GrammarTopic, aiReady: boolean): "practise" | "ai" | null {
  if (topic.detects.length > 0 && topic.practice.length > 0) return "practise";
  const aiFill = topic.detects.length > 0 && topic.practice.includes("scramble");
  return aiReady && aiFill ? "ai" : null;
}

/** Route component for /grammar/$topic. */
export function GrammarTopicRoute() {
  const { topic } = useParams({ from: "/grammar/$topic" });
  return <GrammarTopicPage key={topic} topicId={topic} />;
}

/** One topic: explanation, pattern, examples (yours, then Tatoeba), mistakes, the path. */
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
  const aiReady = useAIReady();

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
  const explanation = withoutPattern(section("explanation")?.markdown ?? "");
  const mistakes = bullets(section("common-mistakes")?.markdown ?? "").map(splitMistake);
  const count = topicCount(topic, overview.data);
  const related = topic.related.map((id) => grammarTopic(id)).filter((t): t is GrammarTopic => !!t);
  const offer = practiceOffer(topic, aiReady);
  const path = curriculum();
  const at = path.findIndex((t) => t.id === topic.id);
  const prev = at > 0 ? path[at - 1] : undefined;
  const next = at >= 0 ? path[at + 1] : undefined;
  const group = groupTitle(topic.group);

  return (
    <div className="page page--list grammar grammar-topic">
      <PageHeader
        back={
          <Link to="/grammar">
            <ArrowLeft size={14} aria-hidden /> Grammar
          </Link>
        }
        title={topic.title}
        lede={inline(topic.summary)}
        actions={
          <>
            <WriteStoryLink preset={{ grammarTopic: topic.id }} />
            {offer ? (
              <Link
                to="/grammar/$topic/practice"
                params={{ topic: topic.id }}
                className="k-btn k-btn--primary"
              >
                {offer === "ai" ? "Practise with AI sentences" : "Practise"}
              </Link>
            ) : null}
          </>
        }
      />
      <p className="grammar-meta">
        <Chip tone="accent" title={LEVEL_LABEL[topic.level]}>
          {topic.level} · {LEVEL_LABEL[topic.level]}
        </Chip>
        {group ? <span>{group}</span> : null}
        {at >= 0 && topic.order ? (
          <span>
            Step {at + 1} of {path.length} on the learning path
          </span>
        ) : null}
        {count && count.hits > 0 ? (
          <span>
            Seen {plural(count.hits, "time")} in {plural(count.texts, "text")} of your Library
          </span>
        ) : null}
      </p>

      {explanation || topic.pattern.length ? (
        <section className="grammar-section grammar-prose" aria-labelledby="g-explanation">
          <h2 id="g-explanation">Explanation</h2>
          <Markdown source={explanation} />
          {topic.pattern.length ? <PatternBox lines={topic.pattern} /> : null}
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
          error={examples.isError ? examples.error : null}
          data={examples.data}
          onRetry={() => void examples.refetch()}
        />
      ) : null}

      {mistakes.length ? (
        <section className="grammar-section" aria-labelledby="g-mistakes">
          <h2 id="g-mistakes">Common mistakes</h2>
          <ul className="grammar-mistakes">
            {mistakes.map((m, i) => (
              <li key={i}>
                <p
                  className={`grammar-mistake ${m.right ? "grammar-mistake--wrong" : "grammar-mistake--note"}`}
                >
                  <X size={16} aria-hidden className="grammar-mistake-icon" />
                  <span className="sr-only">Mistake: </span>
                  <span>{inline(m.wrong, `w${i}-`)}</span>
                </p>
                {m.right ? (
                  <p className="grammar-mistake grammar-mistake--right">
                    <Check size={16} aria-hidden className="grammar-mistake-icon" />
                    <span className="sr-only">Instead: </span>
                    <span>{inline(m.right, `r${i}-`)}</span>
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {related.length ? (
        <section className="grammar-section" aria-labelledby="g-related">
          <h2 id="g-related">Related topics</h2>
          <ul className="grammar-list">
            {related.map((r) => (
              <li key={r.id}>
                <Link to="/grammar/$topic" params={{ topic: r.id }} className="grammar-row">
                  <span className="grammar-row-main">
                    <span className="grammar-row-title">{r.title}</span>
                  </span>
                  <span className="grammar-row-meta">
                    <Chip title={LEVEL_LABEL[r.level]}>{r.level}</Chip>
                  </span>
                  <ChevronRight size={16} aria-hidden className="grammar-row-chevron" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {prev || next ? (
        <nav className="grammar-pager" aria-label="Learning path">
          {prev ? (
            <Link
              to="/grammar/$topic"
              params={{ topic: prev.id }}
              className="grammar-pager-link"
              rel="prev"
            >
              <span className="grammar-pager-dir">
                <ArrowLeft size={14} aria-hidden /> Previous
              </span>
              <span className="grammar-pager-title">{prev.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link
              to="/grammar/$topic"
              params={{ topic: next.id }}
              className="grammar-pager-link grammar-pager-link--next"
              rel="next"
            >
              <span className="grammar-pager-dir">
                Next <ArrowRight size={14} aria-hidden />
              </span>
              <span className="grammar-pager-title">{next.title}</span>
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}

/** The `### Pattern` lines as a box: rule on the left, the Dutch example after the arrow. */
function PatternBox({ lines }: { lines: string[] }) {
  return (
    <figure className="grammar-pattern" aria-labelledby="g-pattern">
      <figcaption id="g-pattern" className="k-overline">
        Pattern
      </figcaption>
      <ul>
        {lines.map((line, i) => {
          const arrow = line.indexOf("→");
          const rule = arrow < 0 ? line : line.slice(0, arrow).trim();
          const eg = arrow < 0 ? "" : line.slice(arrow + 1).trim();
          return (
            <li key={i} className={eg ? undefined : "grammar-pattern-solo"}>
              <span className="grammar-pattern-rule">{inline(rule, `p${i}-`)}</span>
              {eg ? (
                <span className="grammar-pattern-eg">
                  <span aria-hidden className="grammar-pattern-arrow">
                    →{" "}
                  </span>
                  {inline(eg, `e${i}-`)}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </figure>
  );
}

function TopicExamplesSection({
  loading,
  error,
  data,
  onRetry,
}: {
  loading: boolean;
  /** The load error, or null. */
  error: unknown;
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
          <ErrorNotice title="Examples could not be loaded." error={error} onRetry={onRetry} />
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
