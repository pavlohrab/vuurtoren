import { Link } from "@tanstack/react-router";
import { ChevronRight, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { CEFR_LEVELS, type GrammarTopic, curriculum, topicsByGroup } from "@app/content";
import { Button, Chip, Tabs } from "@app/ui";
import { PageHeader } from "../shell/PageHeader.js";
import type { GrammarOverview } from "../services/types.js";
import { inline } from "./Markdown.js";
import { LEVEL_LABEL, LEVEL_LINE, topicCount, useGrammarOverview } from "./GrammarCommon.js";
import { plural } from "../format.js";
import "./grammar.css";
import { readLocal, writeLocal } from "../storage/local.js";

export { LEVEL_LABEL, MarkedSentence, topicCount } from "./GrammarCommon.js";
export { GrammarTopicPage, GrammarTopicRoute } from "./GrammarTopic.js";

type View = "path" | "topic";
const VIEW_KEY = "kenning.grammar.view";
const VIEWS = [
  { value: "path", label: "Learning path" },
  { value: "topic", label: "By topic" },
] as const;

function readView(): View {
  return readLocal(VIEW_KEY) === "topic" ? "topic" : "path";
}
function writeView(v: View) {
  writeLocal(VIEW_KEY, v);
}

/** Lower-case, accent- and Markdown-free text for search. */
const fold = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").replace(/[*_`]/g, "").toLowerCase();

/** True when the topic's title or summary contains every word of `query`. */
export function matchTopic(topic: GrammarTopic, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold(`${topic.title} ${topic.summary}`);
  return words.every((w) => hay.includes(w));
}

interface Shelf {
  id: string;
  title: string;
  code?: string;
  line?: string;
  topics: GrammarTopic[];
}

/** /grammar: the learning path (by level) or the topic shelves, with search. */
export function Grammar() {
  const overview = useGrammarOverview();
  const o = overview.data;
  const [view, setView] = useState<View>(readView);
  const [query, setQuery] = useState("");

  const shelves = useMemo<Shelf[]>(() => {
    if (view === "topic") {
      return topicsByGroup().map((g) => ({ id: g.group, title: g.title, topics: g.topics }));
    }
    const path = curriculum();
    return CEFR_LEVELS.map((level) => ({
      id: level,
      code: level,
      title: LEVEL_LABEL[level],
      line: LEVEL_LINE[level],
      topics: path.filter((t) => t.level === level),
    })).filter((s) => s.topics.length > 0);
  }, [view]);
  const shown = shelves
    .map((s) => ({ ...s, topics: s.topics.filter((t) => matchTopic(t, query)) }))
    .filter((s) => s.topics.length > 0);
  const total = shown.reduce((n, s) => n + s.topics.length, 0);

  return (
    <div className="page page--list grammar">
      <PageHeader
        title="Grammar"
        lede="Short topics with examples from what you read. Follow the learning path, or browse by topic."
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

      <div className="grammar-tools">
        <Tabs
          aria-label="Arrange topics"
          items={VIEWS}
          value={view}
          onValueChange={(v) => {
            const next = v === "topic" ? "topic" : "path";
            setView(next);
            writeView(next);
          }}
        />
        <label className="grammar-search">
          <Search size={16} aria-hidden className="grammar-search-icon" />
          <input
            className="k-input"
            type="search"
            aria-label="Search topics"
            placeholder="Search topics"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      {query.trim() ? (
        <p className="k-hint grammar-count" role="status">
          {plural(total, "topic")}
        </p>
      ) : null}

      {shown.length === 0 ? (
        <div className="grammar-empty">
          <p>No topic matches “{query.trim()}”.</p>
          <Button variant="secondary" onClick={() => setQuery("")}>
            Clear search
          </Button>
        </div>
      ) : (
        shown.map((s) => (
          <section key={s.id} className="grammar-level" aria-labelledby={`shelf-${s.id}`}>
            <h2 id={`shelf-${s.id}`} className="grammar-level-title">
              {s.code ? <span className="grammar-level-code">{s.code}</span> : null} {s.title}
            </h2>
            {s.line ? <p className="grammar-level-line">{s.line}</p> : null}
            <ul className="grammar-list">
              {s.topics.map((t) => (
                <TopicRow key={t.id} topic={t} overview={o} numbered={view === "path"} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function TopicRow({
  topic: t,
  overview,
  numbered,
}: {
  topic: GrammarTopic;
  overview: GrammarOverview | undefined;
  numbered: boolean;
}) {
  const count = topicCount(t, overview);
  return (
    <li>
      <Link to="/grammar/$topic" params={{ topic: t.id }} className="grammar-row">
        {numbered && t.order ? (
          <span className="grammar-row-num" aria-hidden>
            {t.order}
          </span>
        ) : null}
        <span className="grammar-row-main">
          <span className="grammar-row-title">{t.title}</span>
          <span className="grammar-row-summary">{inline(t.summary)}</span>
        </span>
        <span className="grammar-row-meta">
          {count && count.hits > 0 ? (
            <span
              className="grammar-row-seen"
              title={`In ${plural(count.texts, "text")} of your Library`}
            >
              seen {count.hits}× in your texts
            </span>
          ) : null}
          <Chip title={LEVEL_LABEL[t.level]}>{t.level}</Chip>
        </span>
        <ChevronRight size={16} aria-hidden className="grammar-row-chevron" />
      </Link>
    </li>
  );
}
