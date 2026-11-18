import { useRef } from "react";
import { mergeOutlineRow, splitOutlineAt } from "@app/core";
import { Button, Input, Select } from "@app/ui";
import type { OutlineRow, PagePreview } from "../../services/courseTypes.js";

const KINDS: { value: OutlineRow["kind"]; label: string }[] = [
  { value: "theme", label: "Unit" },
  { value: "grammar", label: "Grammar" },
  { value: "transcripts", label: "Transcripts" },
  { value: "wordlist", label: "Word list" },
  { value: "other", label: "Other" },
];

/**
 * The outline editor: units on the left (title, kind, page range, merge, remove) and every page
 * of the book on the right with its first lines, so a unit boundary is set by clicking the page
 * where a unit starts ("Start a unit here"), not by guessing page numbers.
 */
export function OutlineEditor({
  rows,
  onChange,
  pages,
}: {
  rows: OutlineRow[];
  onChange: (rows: OutlineRow[]) => void;
  pages: PagePreview[] | undefined;
}) {
  const strip = useRef<HTMLOListElement>(null);
  const update = (i: number, patch: Partial<OutlineRow>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const starts = new Map(rows.map((r, i) => [r.pages[0], i]));
  const unitOf = (page: number) => rows.findIndex((r) => page >= r.pages[0] && page <= r.pages[1]);
  const show = (page: number) =>
    strip.current
      ?.querySelector(`[data-page="${page}"]`)
      ?.scrollIntoView({ block: "start", behavior: "smooth" });

  return (
    <div className="cs-outline">
      <ol className="cs-outline-units" aria-label="Units">
        {rows.map((r, i) => (
          <li key={i} className="cs-outline-unit">
            <Input
              aria-label={`Title of unit ${i + 1}`}
              value={r.title}
              onChange={(e) => update(i, { title: e.target.value })}
            />
            <div className="cs-outline-meta">
              <Select
                {...(i === 0 ? { label: "Kind" } : {})}
                value={r.kind}
                onValueChange={(v) => update(i, { kind: v as OutlineRow["kind"] })}
                options={KINDS}
              />
              <span className="cs-range">
                <span className="cs-meta">pages</span>
                <input
                  className="k-input"
                  type="number"
                  min={1}
                  aria-label={`First page of unit ${i + 1}`}
                  value={r.pages[0]}
                  onChange={(e) => update(i, { pages: [Number(e.target.value), r.pages[1]] })}
                />
                <span aria-hidden>–</span>
                <input
                  className="k-input"
                  type="number"
                  min={1}
                  aria-label={`Last page of unit ${i + 1}`}
                  value={r.pages[1]}
                  onChange={(e) => update(i, { pages: [r.pages[0], Number(e.target.value)] })}
                />
              </span>
            </div>
            <div className="cs-outline-tools">
              {pages ? (
                <Button size="sm" variant="ghost" onClick={() => show(r.pages[0])}>
                  Show pages
                </Button>
              ) : null}
              {i > 0 ? (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Merge unit ${i + 1} into the one above`}
                  onClick={() => onChange(mergeOutlineRow(rows, i))}
                >
                  Merge up
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove unit ${i + 1}`}
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
              >
                Remove
              </Button>
            </div>
          </li>
        ))}
      </ol>
      {pages && pages.length > 0 ? (
        <section className="cs-pages" aria-label="Pages of the book">
          <p className="cs-meta">Click the page where a unit starts.</p>
          <ol ref={strip} className="cs-page-strip">
            {pages.map((p) => {
              const startOf = starts.get(p.n);
              const inUnit = unitOf(p.n);
              return (
                <li
                  key={p.n}
                  data-page={p.n}
                  className="cs-page"
                  data-start={startOf !== undefined || undefined}
                  data-outside={inUnit < 0 || undefined}
                >
                  <span className="cs-page-n">{p.n}</span>
                  <span className="cs-page-lines" lang="nl">
                    {startOf !== undefined ? (
                      <strong className="cs-page-unit">{rows[startOf]?.title}</strong>
                    ) : null}
                    {p.lines.length ? (
                      p.lines.slice(0, 2).map((l, k) => <span key={k}>{l}</span>)
                    ) : (
                      <span className="cs-hint">No text on this page</span>
                    )}
                  </span>
                  {startOf === undefined ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="cs-page-split"
                      onClick={() =>
                        onChange(
                          splitOutlineAt(
                            rows,
                            p.n,
                            p.lines[0]?.slice(0, 60) || `Unit ${rows.length + 1}`,
                          ),
                        )
                      }
                    >
                      Start a unit here
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
