import { Link } from "@tanstack/react-router";
import type { GrammarHit } from "@app/core";
import { type GrammarTopic, topicForHit } from "@app/content";
import { Chip } from "@app/ui";
import { inline } from "./Markdown.js";
import "./grammar.css";

/** The hits of one token, one entry per topic page (first note wins). */
export function notesFor(hits: readonly GrammarHit[]): { topic: GrammarTopic; note: string }[] {
  const out: { topic: GrammarTopic; note: string }[] = [];
  for (const h of hits) {
    const topic = topicForHit(h.topic);
    if (topic && !out.some((o) => o.topic.id === topic.id)) out.push({ topic, note: h.note });
  }
  return out;
}

/** Spotlight label for a token: the titles of its topics ("Inversion · Separable verbs"). */
export function spotlightLabel(detectors: readonly string[]): string {
  const titles: string[] = [];
  for (const d of detectors) {
    const title = topicForHit(d)?.title;
    if (title && !titles.includes(title)) titles.push(title);
  }
  return titles.join(" · ");
}

/**
 * The grammar of the selected word, shown in the inspector under the word: per topic its title
 * and level, the note for this occurrence, the topic's summary and a link to the topic page.
 */
export function GrammarNotes({ hits }: { hits: readonly GrammarHit[] }) {
  const notes = notesFor(hits);
  if (notes.length === 0) return null;
  return (
    <section className="grammar-notes" aria-label="Grammar">
      <p className="k-label grammar-notes-label">Grammar</p>
      {notes.map(({ topic, note }) => (
        <div key={topic.id} className="grammar-notes-item">
          <div className="grammar-notes-title">
            <span>{topic.title}</span>
            <Chip>{topic.level}</Chip>
          </div>
          <p>{note}</p>
          <p className="grammar-notes-summary">{inline(topic.summary)}</p>
          <Link
            to="/grammar/$topic"
            params={{ topic: topic.id }}
            className="grammar-notes-link"
            aria-label={`Open the topic: ${topic.title}`}
          >
            Open the topic
          </Link>
        </div>
      ))}
    </section>
  );
}
