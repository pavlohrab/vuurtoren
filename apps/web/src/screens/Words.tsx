/**
 * Words: the hub of the learning loop. Every word Kenning knows about, filterable by state,
 * source (a text, a course unit, the last practice session) and search, all kept in the URL
 * (`/words?state=&source=text:<id>|unit:<course>/<n>|practice-again&q=&word=<key>`). A row
 * opens the shared word inspector with the reader's actions; a selection goes to Anki, to
 * Practice or to Talk in one step.
 */
import { pct, plural } from "../format.js";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Dumbbell, Languages, MessagesSquare, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { WordState } from "@app/core";
import {
  AddToAnki,
  Button,
  EmptyState,
  Input,
  Lemma,
  Select,
  Skeleton,
  WORD_STATE_LABEL,
  WordInspector,
  WordStateChip,
  useToast,
} from "@app/ui";
import { readPracticeAgain } from "../lastPractice.js";
import { useServices } from "../services/context.js";
import { errorText } from "../services/errors.js";
import type { AppServices, InspectorEntry } from "../services/types.js";
import { PageHeader } from "../shell/PageHeader.js";
import { useShell } from "../shell/ShellContext.js";
import { revealAboveSheet } from "../shell/revealAboveSheet.js";
import { useDebounced } from "../useDebounced.js";
import { SuggestedWords } from "./SuggestedWords.js";
import { useWordActions } from "./useWordActions.js";
import "./words.css";

const PAGE_SIZE = 50;
const STATES: WordState[] = ["known", "learning", "seen", "unknown", "ignored"];

/** Where the listed words come from (the `source` search param). */
export type WordSource =
  | { kind: "text"; textId: string }
  | { kind: "unit"; courseId: string; unit: number }
  | { kind: "practice-again" };

/** Parse `source`: "text:<id>", "unit:<course>/<n>" or "practice-again"; null otherwise. */
export function parseSource(raw: string | undefined): WordSource | null {
  if (!raw) return null;
  if (raw === "practice-again") return { kind: "practice-again" };
  if (raw.startsWith("text:") && raw.length > 5) return { kind: "text", textId: raw.slice(5) };
  const unit = /^unit:(.+)\/(\d+)$/.exec(raw);
  if (unit) return { kind: "unit", courseId: unit[1]!, unit: Number(unit[2]) };
  return null;
}

/** One row of the table, whatever the source. */
export interface WordRow {
  key: string;
  lemma: string;
  article?: string | undefined;
  state: WordState;
  appLearning?: boolean | undefined;
  pKnown: number | null;
  gloss?: string | undefined;
  decks: string[];
  /** Inspector entry when the source has one (a text: with its sentence from that text). */
  entry?: InspectorEntry;
}

/** Rows for a source and filters. Text and unit lists are filtered here; the rest by the service. */
export async function loadRows(
  services: AppServices,
  source: WordSource | null,
  filters: { state?: WordState | undefined; query?: string | undefined; limit: number },
): Promise<WordRow[]> {
  const { state, query, limit } = filters;
  const q = query?.toLowerCase();
  const keep = (r: WordRow) =>
    (!state || r.state === state) &&
    (!q || r.key.toLowerCase().includes(q) || (r.gloss ?? "").toLowerCase().includes(q));
  if (source?.kind === "text") {
    const items = await services.textWords(source.textId, { includeGlossed: true });
    return items
      .map((w): WordRow => ({
        key: w.key,
        lemma: w.lemma,
        article: w.pos === "NOUN" ? w.article : undefined,
        state: w.entry.state,
        appLearning: w.entry.appLearning,
        pKnown: w.entry.pKnown,
        gloss: w.glosses[0],
        decks: w.entry.decks,
        entry: w.entry,
      }))
      .filter(keep);
  }
  if (source?.kind === "unit") {
    const u = await services.unit(source.courseId, source.unit);
    return (u?.words ?? [])
      .map((w): WordRow => ({
        key: w.key,
        lemma: w.lemma,
        article: w.article ?? undefined,
        state: w.state === "absent" ? "unknown" : w.state,
        pKnown: null,
        gloss: w.gloss ?? undefined,
        decks: w.decks,
      }))
      .filter(keep);
  }
  const keys = source?.kind === "practice-again" ? readPracticeAgain() : undefined;
  if (keys && keys.length === 0) return [];
  const infos = await services.words({
    limit,
    ...(keys ? { keys } : {}),
    ...(state ? { state } : {}),
    ...(query ? { query } : {}),
  });
  return infos.map((w) => ({
    key: w.key,
    lemma: w.key,
    article: w.article,
    state: w.state,
    appLearning: w.appLearning,
    pKnown: w.pKnown,
    gloss: w.gloss,
    decks: w.decks,
  }));
}

interface WordsSearch {
  state?: string;
  source?: string;
  q?: string;
  word?: string;
}

/** Words: filterable table of lemmas; rows open the inspector; selections go on to Anki, Practice or Talk. */
export function Words() {
  const services = useServices();
  const toast = useToast();
  const qc = useQueryClient();
  const params: WordsSearch = useSearch({ from: "/words" });
  const navigate = useNavigate();
  const { inspectorEl, setInspectorAvailable, setInspectorOpen } = useShell();

  const state = STATES.includes(params.state as WordState)
    ? (params.state as WordState)
    : undefined;
  const source = parseSource(params.source);
  const word = params.word;
  const setSearch = (patch: Partial<Record<keyof WordsSearch, string | undefined>>) => {
    const next: Record<string, string | undefined> = { ...params, ...patch };
    const clean: WordsSearch = {};
    for (const k of ["state", "source", "q", "word"] as const) if (next[k]) clean[k] = next[k];
    void navigate({ to: "/words", search: clean, replace: true });
  };

  // Search as the learner pauses typing; the URL follows.
  const [draft, setDraft] = useState(params.q ?? "");
  const search = useDebounced(draft.trim(), 250);
  useEffect(() => {
    if ((params.q ?? "") !== search) setSearch({ q: search || undefined });
    // Only the debounced value drives the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const rows = useQuery({
    queryKey: ["words", "rows", params.source ?? null, state ?? null, params.q ?? "", limit],
    queryFn: () => loadRows(services, source, { state, query: params.q, limit }),
    placeholderData: keepPreviousData,
  });
  const texts = useQuery({ queryKey: ["texts"], queryFn: () => services.listTexts() });
  const unitKey = source?.kind === "unit" ? source : null;
  const unitQ = useQuery({
    queryKey: ["unit", unitKey?.courseId ?? null, unitKey?.unit ?? null],
    queryFn: () => services.unit(unitKey!.courseId, unitKey!.unit),
    enabled: unitKey !== null,
  });
  const sourceLabel =
    source?.kind === "text"
      ? (texts.data?.find((t) => t.id === source.textId)?.title ?? "a text")
      : source?.kind === "unit"
        ? unitQ.data
          ? `${unitQ.data.course.title} · ${unitQ.data.unit.title}`
          : `Unit ${source.unit}`
        : source?.kind === "practice-again"
          ? "Last practice session"
          : null;

  // The inspector: the row's own entry when the source has one, else looked up by key.
  const list = rows.data ?? [];
  const rowEntry = word ? list.find((r) => r.key === word)?.entry : undefined;
  const inspect = useQuery({
    queryKey: ["inspect-word", word],
    queryFn: () => services.inspectWord(word!),
    enabled: Boolean(word) && !rowEntry,
  });
  const entry = rowEntry ?? (word ? (inspect.data ?? null) : null);
  const actions = useWordActions("reading");

  useEffect(() => {
    setInspectorAvailable(Boolean(word));
    if (word) setInspectorOpen(true);
  }, [word, setInspectorAvailable, setInspectorOpen]);
  useEffect(() => () => setInspectorAvailable(false), [setInspectorAvailable]);

  const open = (key: string, row?: Element | null) => {
    setSearch({ word: key });
    setInspectorOpen(true);
    revealAboveSheet(row ?? null);
  };
  const toggle = (key: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const allSelected = list.length > 0 && list.every((r) => selected.has(r.key));
  const chosen = list.filter((r) => selected.has(r.key));
  const chosenKeys = chosen.map((r) => r.key);

  // Bulk add: words not in Anki yet go to the chosen deck; the rest are counted, not touched.
  const bulkAdd = useMutation({
    mutationFn: async (picked: WordRow[]) => {
      let added = 0;
      let skipped = 0;
      let failed = 0;
      let deck = "";
      const opts = actions.deckChoice.chosen ? { deck: actions.deckChoice.chosen } : undefined;
      for (const r of picked) {
        try {
          const e = r.entry ?? (await services.inspectWord(r.key));
          if (e.anki.status !== "absent") {
            skipped++;
            continue;
          }
          deck = (await services.addToAnki(e, opts)).deck;
          added++;
        } catch {
          // counted; the summary toast reports how many failed
          failed++;
        }
      }
      return { added, skipped, failed, deck };
    },
    onSuccess: ({ added, skipped, failed, deck }) => {
      const notes = [
        skipped ? `${skipped} already in Anki` : "",
        failed ? `${failed} could not be added` : "",
      ].filter(Boolean);
      toast(
        added ? `Added ${plural(added, "word")} to ${deck}` : "Nothing to add",
        notes.length ? notes.join(" · ") : undefined,
      );
      setSelected(new Set());
      for (const k of ["words", "inspect-word", "texts", "learner", "home", "textWords"])
        void qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => toast("Could not add the words", errorText(e)),
  });

  const filtered = Boolean(state || source || params.q);
  const practiseKeys = (chosenKeys.length ? chosenKeys : list.map((r) => r.key)).slice(0, 30);
  const again = readPracticeAgain();
  const sourceOptions = [
    { value: "all", label: "All words" },
    ...(again.length || source?.kind === "practice-again"
      ? [{ value: "practice-again", label: "Last practice session" }]
      : []),
    ...(texts.data ?? []).map((t) => ({ value: `text:${t.id}`, label: t.title })),
    ...(source?.kind === "unit" ? [{ value: params.source!, label: sourceLabel ?? "Unit" }] : []),
  ];

  return (
    <div className="page page--list words-page">
      <PageHeader
        title="Words"
        lede="Every word Kenning knows about, from Anki and from your reading. Open one to act on it."
        actions={
          list.length > 0 ? (
            <Link
              to="/practice"
              search={filtered ? { words: practiseKeys.join(",") } : {}}
              className="k-btn k-btn--primary"
            >
              <Dumbbell size={16} aria-hidden /> {filtered ? "Practise these words" : "Practise"}
            </Link>
          ) : null
        }
      />

      <div className="words-filters" role="group" aria-label="Filters">
        <div className="words-states" role="radiogroup" aria-label="State">
          {[undefined, ...STATES].map((s) => (
            <button
              key={s ?? "all"}
              type="button"
              role="radio"
              aria-checked={state === s}
              className="words-state"
              onClick={() => {
                setLimit(PAGE_SIZE);
                setSearch({ state: s });
              }}
            >
              {s ? WORD_STATE_LABEL[s] : "All"}
            </button>
          ))}
        </div>
        <div className="words-filter-fields">
          <div className="words-source">
            <Select
              label="Source"
              value={params.source ?? "all"}
              options={sourceOptions}
              onValueChange={(v) => {
                setLimit(PAGE_SIZE);
                setSelected(new Set());
                setSearch({ source: v === "all" ? undefined : v });
              }}
            />
          </div>
          <div className="words-search">
            <Input
              label="Search"
              type="search"
              value={draft}
              placeholder="Word or meaning"
              onChange={(e) => {
                setDraft(e.target.value);
                setLimit(PAGE_SIZE);
              }}
            />
          </div>
        </div>
      </div>

      <SuggestedWords />

      {filtered ? (
        <ul className="words-chips" aria-label="Active filters">
          {sourceLabel ? (
            <FilterChip
              label={`From: ${sourceLabel}`}
              onClear={() => setSearch({ source: undefined })}
            />
          ) : null}
          {state ? (
            <FilterChip
              label={`State: ${WORD_STATE_LABEL[state]}`}
              onClear={() => setSearch({ state: undefined })}
            />
          ) : null}
          {params.q ? (
            <FilterChip
              label={`Search: “${params.q}”`}
              onClear={() => {
                setDraft("");
                setSearch({ q: undefined });
              }}
            />
          ) : null}
          <li>
            <button
              type="button"
              className="link-button words-clear"
              onClick={() => {
                setDraft("");
                void navigate({ to: "/words", search: word ? { word } : {}, replace: true });
              }}
            >
              Clear filters
            </button>
          </li>
        </ul>
      ) : null}

      {rows.isPending ? (
        <Skeleton style={{ height: 160, borderRadius: 10 }} />
      ) : rows.isError ? (
        <p className="error-text">Words could not be loaded. {errorText(rows.error)}</p>
      ) : list.length === 0 && !filtered ? (
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
      ) : list.length === 0 ? (
        <EmptyState
          title="No words match"
          description={
            source?.kind === "practice-again"
              ? "Nothing to look at again: every answer in your last session was right."
              : "Try a different state, source or search."
          }
        />
      ) : (
        <>
          <div className="words-table-wrap">
            <table className="data-table words-table">
              <thead>
                <tr>
                  <th className="words-check">
                    <input
                      type="checkbox"
                      aria-label="Select all words shown"
                      checked={allSelected}
                      onChange={() =>
                        setSelected(allSelected ? new Set() : new Set(list.map((r) => r.key)))
                      }
                    />
                  </th>
                  <th>Word</th>
                  <th>State</th>
                  <th className="words-col-recall">Recall</th>
                  <th>Meaning</th>
                  <th className="words-col-decks">Decks</th>
                </tr>
              </thead>
              <tbody>
                {list.map((w) => (
                  <tr
                    key={w.key}
                    aria-selected={w.key === word}
                    className="words-row"
                    onClick={(e) => {
                      if ((e.target as Element).closest("input,button,a")) return;
                      open(w.key, e.currentTarget);
                    }}
                  >
                    <td className="words-check">
                      <input
                        type="checkbox"
                        aria-label={`Select ${w.lemma}`}
                        checked={selected.has(w.key)}
                        onChange={() => toggle(w.key)}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="words-open"
                        aria-label={`Open ${w.lemma}`}
                        onClick={(e) => open(w.key, e.currentTarget.closest("tr"))}
                      >
                        <Lemma lemma={w.lemma} article={w.article} />
                      </button>
                    </td>
                    <td>
                      <WordStateChip state={w.state} inKenning={w.appLearning} />
                    </td>
                    <td className="k-mono words-col-recall">
                      {w.pKnown === null ? "–" : `${pct(w.pKnown)}`}
                    </td>
                    <td className="words-gloss">{w.gloss ?? ""}</td>
                    <td className="words-col-decks">{w.decks.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!source && list.length >= limit ? (
            <div className="words-more">
              <Button onClick={() => setLimit((l) => l + PAGE_SIZE)}>Show more</Button>
            </div>
          ) : null}
        </>
      )}

      {chosen.length > 0 ? (
        <div className="words-bulk" role="region" aria-label="Selected words">
          <span className="words-bulk-count">{chosen.length} selected</span>
          {actions.deckChoice.addDeck ? (
            <AddToAnki
              {...actions.deckChoice.addDeck}
              size="sm"
              label={bulkAdd.isPending ? "Adding to" : "Add to"}
              disabled={bulkAdd.isPending}
              onAdd={() => bulkAdd.mutate(chosen)}
            />
          ) : (
            <Button size="sm" disabled={bulkAdd.isPending} onClick={() => bulkAdd.mutate(chosen)}>
              Add to Anki
            </Button>
          )}
          <Link
            to="/practice"
            search={{ words: chosenKeys.join(",") }}
            className="k-btn k-btn--secondary k-btn--sm"
          >
            <Dumbbell size={14} aria-hidden /> Practise these
          </Link>
          <Link
            to="/talk"
            search={{ words: chosenKeys.slice(0, 8).join(",") }}
            className="k-btn k-btn--secondary k-btn--sm"
          >
            <MessagesSquare size={14} aria-hidden /> Talk about these
          </Link>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      ) : null}

      {inspectorEl && word
        ? createPortal(
            <WordInspector
              entry={entry}
              loading={!entry && !inspect.isError}
              error={inspect.isError ? errorText(inspect.error) : null}
              onRetry={() => void inspect.refetch()}
              emptyText="Select a word to see its details."
              {...actions.props(entry)}
            />,
            inspectorEl,
          )
        : null}
    </div>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <li className="words-chip">
      <span>{label}</span>
      <button type="button" aria-label={`Remove filter ${label}`} onClick={onClear}>
        <X size={14} aria-hidden />
      </button>
    </li>
  );
}
