import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useState } from "react";
import type { GrammarTopic } from "@app/content";
import { inline } from "../Markdown.js";

/**
 * What an open margin mark shows: the topic, this sentence's note, a one-line rule, a link to
 * the topic page and "Focus on this" (marks the topic all through the text).
 */
export function MarkCard({
  topic,
  note,
  onFocus,
}: {
  topic: GrammarTopic;
  note: string | undefined;
  onFocus: () => void;
}) {
  return (
    <div className="gmark-card">
      <p className="gmark-card-title">
        <span>{topic.title}</span>
        <span className="gmark-card-level">{topic.level}</span>
      </p>
      {note ? <p className="gmark-card-note">{note}</p> : null}
      <p className="gmark-card-rule">{inline(topic.summary)}</p>
      <div className="gmark-card-actions">
        <button type="button" className="k-btn k-btn--sm" onClick={onFocus}>
          Focus on this
        </button>
        <Link to="/grammar/$topic" params={{ topic: topic.id }} className="k-link">
          Open the topic
        </Link>
      </div>
    </div>
  );
}

export interface PickerTopic {
  topic: GrammarTopic;
  /** Hits in the whole text. */
  count: number;
}

/**
 * The grammar focus picker (shown inside the reader's "…" menu): choose one topic to mark all
 * through the text. Suggested topics first (at the learner's level, recently used), then every
 * topic found in the text.
 */
export function GrammarTopics({
  topics,
  suggested,
  value,
  onChange,
  unavailable,
}: {
  topics: readonly PickerTopic[];
  suggested: readonly PickerTopic[];
  value: GrammarTopic | null;
  onChange: (topic: GrammarTopic | null) => void;
  unavailable?: boolean;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const match = (t: PickerTopic) =>
    q === "" || t.topic.title.toLowerCase().includes(q) || t.topic.id.includes(q);
  const shownSuggested = q ? [] : suggested;
  const shownAll = topics.filter(match);
  const item = (t: PickerTopic, group: string) => (
    <button
      key={`${group}-${t.topic.id}`}
      type="button"
      role="option"
      aria-selected={value?.id === t.topic.id}
      className="gpick-item"
      onClick={() => onChange(t.topic)}
    >
      <span className="gpick-item-title">{t.topic.title}</span>
      <span className="gpick-item-meta">
        {t.topic.level} · {t.count}
      </span>
    </button>
  );
  return (
    <div className="gpick">
      <label className="gpick-search">
        <Search size={14} aria-hidden />
        <input
          type="search"
          value={query}
          placeholder="Search topics"
          aria-label="Search grammar topics"
          onChange={(e) => setQuery(e.target.value)}
          // Enter picks the first match.
          onKeyDown={(e) => {
            const first = shownAll[0];
            if (e.key === "Enter" && first) {
              e.preventDefault();
              onChange(first.topic);
            }
          }}
        />
      </label>
      <div className="gpick-list" role="listbox" aria-label="Grammar topics">
        {unavailable ? (
          <p className="gpick-empty">Grammar is unavailable: the language server is unreachable.</p>
        ) : null}
        {shownSuggested.length > 0 ? (
          <>
            <p className="gpick-group">Suggested</p>
            {shownSuggested.map((t) => item(t, "s"))}
          </>
        ) : null}
        {shownAll.length > 0 ? (
          <>
            <p className="gpick-group">{q ? "Matching" : "In this text"}</p>
            {shownAll.map((t) => item(t, "a"))}
          </>
        ) : !unavailable ? (
          <p className="gpick-empty">
            {q ? "No topic in this text matches." : "No grammar found in this text yet."}
          </p>
        ) : null}
      </div>
      {value ? (
        <button type="button" className="gpick-off" onClick={() => onChange(null)}>
          Turn the grammar focus off
        </button>
      ) : null}
    </div>
  );
}

/**
 * The active grammar focus as a compact removable chip in the reader bar:
 * "Passive · 4 ‹ › ×". The topic name reopens the picker.
 */
export function FocusChip({
  topic,
  count,
  current,
  onStep,
  onClear,
  onChange,
}: {
  topic: GrammarTopic;
  count: number;
  /** Index of the hit jumped to, or null. */
  current: number | null;
  onStep: (dir: 1 | -1) => void;
  onClear: () => void;
  onChange: () => void;
}) {
  return (
    <div className="gfocus" role="group" aria-label="Grammar focus">
      <button
        type="button"
        className="gfocus-topic"
        aria-label={`Grammar focus: ${topic.title}. Change`}
        onClick={onChange}
      >
        {topic.title}
      </button>
      <span className="gfocus-count" role="status">
        <span aria-hidden>
          · {count === 0 ? "none" : current === null ? count : `${current + 1}/${count}`}
        </span>
        <span className="k-sr">
          {count === 0
            ? "None on this page"
            : current === null
              ? `${count} on this page`
              : `${current + 1} of ${count} on this page`}
        </span>
      </span>
      {count > 0 ? (
        <>
          <button
            type="button"
            className="gfocus-btn"
            aria-label="Previous one"
            onClick={() => onStep(-1)}
          >
            <ChevronLeft size={15} aria-hidden />
          </button>
          <button
            type="button"
            className="gfocus-btn"
            aria-label="Next one"
            onClick={() => onStep(1)}
          >
            <ChevronRight size={15} aria-hidden />
          </button>
        </>
      ) : null}
      <button
        type="button"
        className="gfocus-btn"
        aria-label="Clear the grammar focus (Esc)"
        title="Clear (Esc)"
        onClick={onClear}
      >
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}
