import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { WordState } from "@app/core";
import { Link } from "@tanstack/react-router";
import { Languages } from "lucide-react";
import {
  Button,
  EmptyState,
  Input,
  Lemma,
  Select,
  Skeleton,
  WORD_STATE_LABEL,
  WordStateChip,
} from "@app/ui";
import { useServices } from "../services/context.js";
import { useDebounced } from "../useDebounced.js";

const PAGE_SIZE = 50;
const STATES: WordState[] = ["known", "learning", "seen", "unknown", "ignored"];
const STATE_OPTIONS = [
  { value: "all", label: "All states" },
  ...STATES.map((value) => ({ value, label: WORD_STATE_LABEL[value] })),
];

/** Words: filterable table of lemmas with state, recall and source decks. */
export function Words() {
  const services = useServices();
  const [state, setState] = useState("all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);

  // Search as the learner pauses typing, and keep the old rows on screen while new ones load.
  const search = useDebounced(query.trim(), 250);

  const q = useQuery({
    queryKey: ["words", state, search, limit],
    queryFn: () =>
      services.words({
        limit,
        ...(state !== "all" ? { state: state as WordState } : {}),
        ...(search ? { query: search } : {}),
      }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="page">
      <h1>Words</h1>
      <p className="page-lede">Every word Kenning knows about, from Anki and from your reading.</p>
      <div className="row" style={{ marginBottom: 16, alignItems: "flex-end" }}>
        <div style={{ width: 220 }}>
          <Select
            label="State"
            value={state}
            options={STATE_OPTIONS}
            onValueChange={(v) => {
              setState(v);
              setLimit(PAGE_SIZE);
            }}
          />
        </div>
        <div style={{ width: 260 }}>
          <Input
            label="Search"
            type="search"
            value={query}
            placeholder="Word or meaning"
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE_SIZE);
            }}
          />
        </div>
      </div>

      {q.isPending ? (
        <Skeleton style={{ height: 160, borderRadius: 10 }} />
      ) : q.isError ? (
        <p className="error-text">Words could not be loaded.</p>
      ) : q.data.length === 0 && state === "all" && !search ? (
        <EmptyState
          icon={<Languages size={28} />}
          title="No words yet"
          description="Words arrive when you sync your Anki decks or read a text. Start with a text you want to read."
          action={
            <Link to="/import" className="k-btn k-btn--primary">
              Import a text
            </Link>
          }
        />
      ) : q.data.length === 0 ? (
        <EmptyState title="No words match" description="Try a different state or search." />
      ) : (
        <>
          <table className="data-table">
            <thead>
              <tr>
                <th>Word</th>
                <th>State</th>
                <th>Recall</th>
                <th>Meaning</th>
                <th>Decks</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((w) => (
                <tr key={w.key}>
                  <td>
                    <Lemma lemma={w.key} article={w.article} />
                  </td>
                  <td>
                    <WordStateChip state={w.state} inKenning={w.appLearning} />
                  </td>
                  <td className="k-mono">{Math.round(w.pKnown * 100)}%</td>
                  <td>{w.gloss ?? ""}</td>
                  <td style={{ color: "var(--ink-muted)" }}>{w.decks.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {q.data.length >= limit ? (
            <div className="row" style={{ marginTop: 16, justifyContent: "center" }}>
              <Button onClick={() => setLimit((l) => l + PAGE_SIZE)}>Show more</Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
