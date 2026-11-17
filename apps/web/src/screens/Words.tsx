import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { WordState } from "@app/core";
import { Button, Chip, EmptyState, Input, Select, Skeleton } from "@app/ui";
import { useServices } from "../services/context.js";

const PAGE_SIZE = 50;
const STATE_OPTIONS = [
  { value: "all", label: "All states" },
  { value: "known", label: "Known" },
  { value: "learning", label: "Learning" },
  { value: "seen", label: "Seen" },
  { value: "unknown", label: "Not yet known" },
  { value: "ignored", label: "Ignored" },
];
const TONE: Record<WordState, "success" | "accent" | "warm" | "neutral"> = {
  known: "success",
  learning: "accent",
  seen: "neutral",
  unknown: "warm",
  ignored: "neutral",
};

/** Words: filterable table of lemmas with state, recall and source decks. */
export function Words() {
  const services = useServices();
  const [state, setState] = useState("all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);

  const q = useQuery({
    queryKey: ["words", state, query, limit],
    queryFn: () =>
      services.words({
        limit,
        ...(state !== "all" ? { state: state as WordState } : {}),
        ...(query.trim() ? { query: query.trim() } : {}),
      }),
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
                  <td lang="nl" style={{ fontFamily: "var(--font-reading)", fontSize: 16 }}>
                    {w.article ? (
                      <span style={{ color: "var(--ink-muted)" }}>{w.article} </span>
                    ) : null}
                    {w.key}
                  </td>
                  <td>
                    <Chip tone={TONE[w.state]}>{w.state}</Chip>
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
