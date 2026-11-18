import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  type AnalyzedToken,
  type GrammarHit,
  type WordNote,
  explainWord,
  hitsAtToken,
} from "@app/core";
import { type GrammarTopic, grammarTopic } from "@app/content";
import { notesFor } from "../GrammarNotes.js";
import { inline } from "../Markdown.js";
import { hitsForTopic } from "./grammarMarks.js";

/** Lines shown before "More about this word". */
const VISIBLE = 3;

interface Line {
  key: string;
  text: string;
  topic: GrammarTopic | undefined;
}

/**
 * The lines for one word: the word-form explainer's notes (@app/core `explainWord`), then the
 * detector notes of topics the explainer did not cover; the plain "lemma: part of speech" line
 * only when nothing else is known. The clause's word order comes separately.
 */
export function wordGrammarLines(
  tokens: readonly AnalyzedToken[],
  index: number,
  hits: readonly GrammarHit[],
  article?: string,
): { lines: Line[]; order: Line | null } {
  const { notes, order } = explainWord(tokens, index, { hits, article });
  const toLine = (n: WordNote): Line => ({
    key: n.key,
    text: n.text,
    topic: n.topic ? grammarTopic(n.topic) : undefined,
  });
  const lines = notes.map(toLine);
  const covered = new Set([...notes, ...(order ? [order] : [])].map((n) => n.topic));
  for (const { topic, note } of notesFor(hitsAtToken(hits, index))) {
    if (!covered.has(topic.id)) lines.push({ key: `hit.${topic.id}`, text: note, topic });
  }
  const real = lines.filter((l) => l.key !== "plain");
  return { lines: real.length > 0 ? real : lines, order: order ? toLine(order) : null };
}

/**
 * "Grammar of this word" in the reader's inspector: 1–3 short lines on why the word has this
 * form, the word order of its clause for a finite verb, each with its topic page and (when the
 * topic occurs in the text) "Focus on this". Further lines and the topic rules are collapsed.
 */
export function WordGrammar({
  tokens,
  index,
  hits,
  article,
  onFocus,
}: {
  tokens: readonly AnalyzedToken[];
  index: number;
  hits: readonly GrammarHit[];
  article?: string | undefined;
  onFocus: (topic: GrammarTopic) => void;
}) {
  const { lines, order } = useMemo(
    () => wordGrammarLines(tokens, index, hits, article),
    [tokens, index, hits, article],
  );
  if (lines.length === 0 && !order) return null;
  const shown = lines.slice(0, VISIBLE);
  const more = lines.slice(VISIBLE);
  const topics = [...lines, ...(order ? [order] : [])]
    .map((l) => l.topic)
    .filter((t, i, all): t is GrammarTopic => !!t && all.findIndex((x) => x?.id === t.id) === i);

  const row = (l: Line, cls = "") => (
    <li key={l.key} className={`word-grammar-line ${cls}`}>
      <p>{l.text}</p>
      {l.topic ? (
        <div className="word-grammar-actions">
          <Link
            to="/grammar/$topic"
            params={{ topic: l.topic.id }}
            className="k-link"
            aria-label={`Open the topic: ${l.topic.title}`}
          >
            {l.topic.title}
          </Link>
          {hitsForTopic(hits, l.topic).length > 0 ? (
            <button
              type="button"
              className="word-grammar-focus"
              aria-label={`Focus on this: ${l.topic.title}`}
              onClick={() => l.topic && onFocus(l.topic)}
            >
              Focus on this
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );

  return (
    <section className="word-grammar" aria-label="Grammar of this word">
      <div className="k-overline">Grammar of this word</div>
      <ul className="word-grammar-list">
        {shown.map((l) => row(l))}
        {order ? row(order, "word-grammar-order") : null}
      </ul>
      {more.length > 0 || topics.length > 0 ? (
        <details className="word-grammar-more">
          <summary>More about this word</summary>
          {more.length > 0 ? (
            <ul className="word-grammar-list">{more.map((l) => row(l))}</ul>
          ) : null}
          <dl>
            {topics.map((t) => (
              <div key={t.id}>
                <dt>
                  {t.title} <span className="word-grammar-level">{t.level}</span>
                </dt>
                <dd>{inline(t.summary)}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </section>
  );
}
