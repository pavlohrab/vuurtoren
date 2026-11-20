/**
 * Words: the hub of the learning loop. It opens on the words to decide on (the new words of
 * your texts without a card, newest text first); other views list words by state, source (a
 * text, a course unit, the last practice session), starter level and search, all kept in the URL
 * (`/words?state=decide|new|learning|known|ignored|all&source=…&level=1…10|other&group=level&q=
 * &word=<key>`). Grouped by level, each level shows how many of its words are known. A row
 * opens the shared word inspector; in Select mode a selection goes to Anki, Practice or Talk.
 */
import { pct, plural } from "../../format.js";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
  Columns3,
  Dumbbell,
  Languages,
  Layers,
  MessagesSquare,
  SquareCheck,
  X,
} from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { WordState } from "@app/core";
import {
  AddToAnki,
  Button,
  EmptyState,
  Input,
  Lemma,
  Popover,
  Select,
  Skeleton,
  WordInspector,
  WordStateChip,
  deckName,
  useNativeMode,
  useToast,
} from "@app/ui";
import { readPracticeAgain } from "../../lastPractice.js";
import { readLocalJSON, writeLocalJSON } from "../../storage/local.js";
import { useServices } from "../../services/context.js";
import { errorText } from "../../services/errors.js";
import type { AppServices, InspectorEntry } from "../../services/types.js";
import type { WordInfo } from "@app/db";
import { PageHeader } from "../../shell/PageHeader.js";
import { ErrorNotice } from "../../shell/ErrorNotice.js";
import { useShell } from "../../shell/ShellContext.js";
import { revealAboveSheet } from "../../shell/revealAboveSheet.js";
import { useDebounced } from "../../useDebounced.js";
import { loadStarterWords } from "../../services/starterWords.js";
import { SuggestedWords } from "./SuggestedWords.js";
import {
  type LevelFilter,
  type LevelProgress,
  type StarterIndex,
  groupByLevel,
  inLevel,
  levelLabel,
  levelProgress,
  parseLevel,
  progressText,
  starterIndex,
} from "./levels.js";
import { useWordActions } from "../useWordActions.js";
import "./words.css";

const PAGE_SIZE = 50;
/** With a level filter or grouping, every word is read and then narrowed here. */
const ALL_WORDS = 100_000;

let starterIndexCache: Promise<StarterIndex> | null = null;
/** The starter list's ranks by key (loaded on first use). */
function loadStarterIndex(): Promise<StarterIndex> {
  starterIndexCache ??= loadStarterWords().then(starterIndex);
  return starterIndexCache;
}

/**
 * Rows narrowed to a starter level and/or ordered by level (`loadRows` reads them all first, so
 * a level is complete), then cut to `limit`.
 */
async function loadLevelRows(
  services: AppServices,
  source: WordSource | null,
  filters: { view: WordsView; query?: string | undefined; limit: number },
  index: StarterIndex,
  level: { only: LevelFilter | null; grouped: boolean },
): Promise<WordRow[]> {
  if (level.only === null && !level.grouped) return loadRows(services, source, filters);
  let rows = await loadRows(services, source, { ...filters, limit: ALL_WORDS });
  if (level.only !== null) rows = inLevel(rows, index, level.only);
  if (level.grouped) rows = groupByLevel(rows, index).flatMap((g) => g.rows);
  return rows.slice(0, filters.limit);
}

/** The views of the list: words to decide on, then by state. */
export type WordsView = "decide" | "due" | "new" | "learning" | "known" | "ignored" | "all";
const VIEWS: { id: WordsView; label: string; native?: true }[] = [
  { id: "decide", label: "To decide" },
  { id: "due", label: "Due", native: true },
  { id: "new", label: "New" },
  { id: "learning", label: "Learning" },
  { id: "known", label: "Known" },
  { id: "ignored", label: "Ignored" },
  { id: "all", label: "All" },
];

/** The view of `state` in the URL; without one, To decide (or All words of a source). */
export function parseView(raw: string | undefined, hasSource: boolean): WordsView {
  if (raw === "unknown" || raw === "seen") return "new";
  const v = VIEWS.find((x) => x.id === raw);
  return v ? v.id : hasSource ? "all" : "decide";
}

/** Does a word belong in a view? "New" holds words met but not learned (new and seen). */
function inView(view: WordsView, r: { state: WordState; hasCard?: boolean | undefined }): boolean {
  if (view === "all" || view === "due") return true;
  const fresh = r.state === "unknown" || r.state === "seen";
  if (view === "decide") return fresh && !r.hasCard;
  if (view === "new") return fresh;
  return r.state === view;
}

/** Optional table columns, off by default; the choice is remembered on this device. */
export interface WordColumns {
  recall: boolean;
  decks: boolean;
}
const COLUMNS_KEY = "vuurtoren-words-columns";
function readColumns(): WordColumns {
  const v = readLocalJSON(COLUMNS_KEY) as Partial<WordColumns> | undefined;
  return { recall: v?.recall === true, decks: v?.decks === true };
}

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
  /** The word has a card (in Anki, or Vuurtoren's own). */
  hasCard?: boolean | undefined;
  /** Inspector entry when the source has one (a text: with its sentence from that text). */
  entry?: InspectorEntry;
  /** Native mode, Due view: when the word's card came due. */
  due?: number;
}

const DAY_MS = 86_400_000;
/** "due today", "due yesterday", "due 3 days ago". */
export function dueAgo(due: number, now = Date.now()): string {
  const days = Math.floor((now - due) / DAY_MS);
  if (days <= 0) return "due today";
  return days === 1 ? "due yesterday" : `due ${days} days ago`;
}

const rowOf = (w: WordInfo): WordRow => ({
  key: w.key,
  lemma: w.key,
  article: w.article,
  state: w.state,
  appLearning: w.appLearning,
  pKnown: w.pKnown,
  gloss: w.gloss,
  decks: w.decks,
  hasCard: w.noteIds.length > 0,
});

/** Rows for a source and filters. Text and unit lists are filtered here; the rest by the service. */
export async function loadRows(
  services: AppServices,
  source: WordSource | null,
  filters: { view: WordsView; query?: string | undefined; limit: number },
): Promise<WordRow[]> {
  const { view, query, limit } = filters;
  const q = query?.toLowerCase();
  const matches = (r: WordRow) =>
    !q || r.key.toLowerCase().includes(q) || (r.gloss ?? "").toLowerCase().includes(q);
  // Due view: the words due now, narrowed to the chosen source.
  const dueAt =
    view === "due"
      ? new Map((await services.dueWords({ limit: 1000 })).map((w) => [w.key, w.due]))
      : null;
  const withDue = (r: WordRow): WordRow =>
    dueAt?.has(r.key) ? { ...r, due: dueAt.get(r.key)! } : r;
  const keep = (r: WordRow) => (dueAt ? dueAt.has(r.key) : inView(view, r)) && matches(r);
  if (view === "due" && !source) {
    return (await services.dueWords({ limit }))
      .map((w) => ({ ...rowOf(w), due: w.due }))
      .filter(matches);
  }
  if (source?.kind === "text") {
    const items = await services.textWords(source.textId);
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
        hasCard: w.entry.anki.noteIds.length > 0,
        entry: w.entry,
      }))
      .filter(keep)
      .map(withDue);
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
        hasCard: w.state !== "absent",
      }))
      .filter(keep)
      .map(withDue);
  }
  const keys = source?.kind === "practice-again" ? readPracticeAgain() : undefined;
  if (keys && keys.length === 0) return [];
  if (dueAt && keys) {
    return (await services.words({ keys }))
      .map(rowOf)
      .filter(keep)
      .map(withDue)
      .sort((a, b) => (a.due ?? 0) - (b.due ?? 0));
  }
  if (view === "decide" && !keys) {
    return (await services.wordsToDecide({ limit })).map(rowOf).filter(matches);
  }
  const base = { limit, ...(keys ? { keys } : {}), ...(query ? { query } : {}) };
  if (view === "new") {
    const [fresh, seen] = await Promise.all([
      services.words({ ...base, state: "unknown" }),
      services.words({ ...base, state: "seen" }),
    ]);
    return [...seen, ...fresh].map(rowOf);
  }
  if (view === "decide") return (await services.words(base)).map(rowOf).filter(keep);
  const state = view === "all" || view === "due" ? undefined : view;
  return (await services.words({ ...base, ...(state ? { state } : {}) })).map(rowOf);
}

interface WordsSearch {
  state?: string;
  source?: string;
  level?: string;
  group?: string;
  q?: string;
  word?: string;
}

/** Words: filterable table of lemmas; rows open the inspector; selections go on to Anki, Practice or Talk. */
export function Words() {
  const services = useServices();
  const toast = useToast();
  const native = useNativeMode();
  const qc = useQueryClient();
  const params: WordsSearch = useSearch({ from: "/words" });
  const navigate = useNavigate();
  const { inspectorEl, setInspectorAvailable, setInspectorOpen } = useShell();

  const source = parseSource(params.source);
  const view = parseView(params.state, source !== null);
  const defaultView: WordsView = source ? "all" : "decide";
  const word = params.word;
  const setSearch = (patch: Partial<Record<keyof WordsSearch, string | undefined>>) => {
    const next: Record<string, string | undefined> = { ...params, ...patch };
    const clean: WordsSearch = {};
    for (const k of ["state", "source", "level", "group", "q", "word"] as const)
      if (next[k]) clean[k] = next[k];
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
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [columns, setColumns] = useState<WordColumns>(readColumns);
  const toggleColumn = (k: keyof WordColumns) =>
    setColumns((c) => {
      const next = { ...c, [k]: !c[k] };
      writeLocalJSON(COLUMNS_KEY, next);
      return next;
    });
  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  // Starter levels: the filter and the grouping (both in the URL).
  const index = useQuery({
    queryKey: ["starter-index"],
    queryFn: loadStarterIndex,
    staleTime: Infinity,
  });
  const level = parseLevel(params.level, index.data);
  const grouped = params.group === "level";
  const rows = useQuery({
    queryKey: ["words", "rows", params.source ?? null, view, params.q ?? "", limit, level, grouped],
    queryFn: async () =>
      level !== null || grouped
        ? loadLevelRows(
            services,
            source,
            { view, query: params.q, limit },
            await loadStarterIndex(),
            { only: level, grouped },
          )
        : loadRows(services, source, { view, query: params.q, limit }),
    placeholderData: keepPreviousData,
  });
  const progress = useQuery({
    queryKey: ["words", "level-progress"],
    queryFn: async () => {
      const idx = await loadStarterIndex();
      const keys = [...idx.rank.keys()];
      return levelProgress(idx, await services.words({ keys, limit: ALL_WORDS }));
    },
    enabled: grouped,
  });
  // Native learners whose profile predates the starter words have no starter decks.
  const starterDecks = useQuery({
    queryKey: ["starter-levels"],
    queryFn: () => services.starterLevels(),
    enabled: grouped && native,
  });
  const noStarterDecks = grouped && native && starterDecks.data?.held.length === 0;
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
        skipped ? `${skipped} already ${native ? "in your words" : "in Anki"}` : "",
        failed ? `${failed} could not be added` : "",
      ].filter(Boolean);
      toast(
        added ? `Added ${plural(added, "word")}${native ? "" : " to Anki"}` : "Nothing to add",
        [added ? deckName(deck) : "", ...notes].filter(Boolean).join(" · ") || undefined,
      );
      stopSelecting();
      for (const k of ["words", "inspect-word", "texts", "learner", "home", "textWords"])
        void qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => toast("Could not add the words", errorText(e)),
  });

  const filtered = Boolean(view !== defaultView || source || params.q || level !== null);
  const levelOptions = [
    { value: "all", label: "All levels" },
    ...(index.data?.levels ?? []).map((l) => ({
      value: String(l.level),
      label: levelLabel(index.data!, l.level),
    })),
    { value: "other", label: "Other words" },
  ];
  const levelName = (l: LevelFilter) =>
    l === "other" ? "Other words" : index.data ? levelLabel(index.data, l) : `Level ${l}`;
  // Grouped: a header row per level (null: Other words); otherwise one group without a header.
  const groups: { level?: number | null; rows: WordRow[] }[] =
    grouped && index.data ? groupByLevel(list, index.data) : [{ rows: list }];
  const span = 3 + Number(selecting) + Number(columns.recall) + Number(columns.decks);
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
        lede="New words from your reading wait here for you to decide: learn them, mark them known or leave them. Open one to act on it."
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
        <div className="words-states" role="radiogroup" aria-label="Show">
          {VIEWS.filter((v) => !v.native || native).map((v) => (
            <button
              key={v.id}
              type="button"
              role="radio"
              aria-checked={view === v.id}
              className="words-state"
              onClick={() => {
                setLimit(PAGE_SIZE);
                setSearch({ state: v.id === defaultView ? undefined : v.id });
              }}
            >
              {v.label}
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
          <div className="words-level">
            <Select
              label="Level"
              value={level === null ? "all" : String(level)}
              options={levelOptions}
              onValueChange={(v) => {
                setLimit(PAGE_SIZE);
                setSelected(new Set());
                setSearch({ level: v === "all" ? undefined : v });
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
          <div className="words-tools">
            <Popover
              align="end"
              label="Columns"
              className="words-columns"
              trigger={
                <Button variant="ghost" size="sm">
                  <Columns3 size={14} aria-hidden /> Columns
                </Button>
              }
            >
              <label className="words-column-opt">
                <input
                  type="checkbox"
                  checked={columns.recall}
                  onChange={() => toggleColumn("recall")}
                />
                Recall
              </label>
              <label className="words-column-opt">
                <input
                  type="checkbox"
                  checked={columns.decks}
                  onChange={() => toggleColumn("decks")}
                />
                Decks
              </label>
            </Popover>
            <Button
              variant={grouped ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={grouped}
              onClick={() => setSearch({ group: grouped ? undefined : "level" })}
            >
              <Layers size={14} aria-hidden /> Group by level
            </Button>
            <Button
              variant={selecting ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={selecting}
              onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
            >
              <SquareCheck size={14} aria-hidden /> Select
            </Button>
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
          {level !== null ? (
            <FilterChip
              label={`Level: ${levelName(level)}`}
              onClear={() => setSearch({ level: undefined })}
            />
          ) : null}
          {view !== defaultView ? (
            <FilterChip
              label={`Showing: ${VIEWS.find((v) => v.id === view)?.label ?? view}`}
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
                // Grouping is a way of showing the list, not a filter: it stays.
                const keep = { ...(word ? { word } : {}), ...(grouped ? { group: "level" } : {}) };
                void navigate({ to: "/words", search: keep, replace: true });
              }}
            >
              Clear filters
            </button>
          </li>
        </ul>
      ) : null}

      {noStarterDecks ? (
        <p className="words-levels-hint">
          <Link to="/settings" search={{ section: "language" }}>
            Add the starter levels in Settings → Language &amp; decks
          </Link>
        </p>
      ) : null}

      {rows.isPending ? (
        <Skeleton style={{ height: 160, borderRadius: 10 }} />
      ) : rows.isError ? (
        <ErrorNotice
          title="Your words could not be loaded."
          error={rows.error}
          onRetry={() => void rows.refetch()}
          retryLabel="Try again"
        />
      ) : list.length === 0 && !filtered ? (
        <EmptyState
          icon={<Languages size={20} />}
          title="No words yet"
          description={
            native
              ? "Words arrive when you read a text or import a deck file. Start with a text you want to read."
              : "Words arrive when you sync your Anki decks or read a text. Start with a text you want to read."
          }
          action={
            <Link to="/import" className="k-btn k-btn--primary">
              Add text
            </Link>
          }
        />
      ) : list.length === 0 && view === "decide" && !source && !params.q ? (
        <EmptyState
          icon={<Languages size={20} />}
          title="Nothing to decide"
          description="Every new word from your texts has a card or a decision. New words appear here as you read."
          action={
            <Link to="/library" className="k-btn k-btn--secondary">
              Find something to read
            </Link>
          }
        />
      ) : list.length === 0 && view === "due" && !source && !params.q ? (
        <EmptyState
          icon={<Languages size={20} />}
          title="Nothing due"
          description="Every card is up to date. Words come back here when their next review is due."
          action={
            <Link to="/library" className="k-btn k-btn--secondary">
              Find something to read
            </Link>
          }
        />
      ) : list.length === 0 ? (
        <EmptyState
          title="No words match"
          description={
            source?.kind === "practice-again"
              ? "Nothing to look at again: every answer in your last session was right."
              : "Try another view, source or search."
          }
        />
      ) : (
        <>
          <div className="words-table-wrap">
            <table className="data-table words-table">
              <thead>
                <tr>
                  {selecting ? (
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
                  ) : null}
                  <th>Word</th>
                  <th>State</th>
                  <th>Meaning</th>
                  {columns.recall ? <th className="words-col-recall">Recall</th> : null}
                  {columns.decks ? <th className="words-col-decks">Decks</th> : null}
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <Fragment key={String(g.level)}>
                    {g.level !== undefined && index.data ? (
                      <LevelHeader
                        label={levelLabel(index.data, g.level)}
                        progress={progress.data?.find((p) => p.level === g.level)}
                        span={span}
                      />
                    ) : null}
                    {g.rows.map((w) => (
                      <tr
                        key={w.key}
                        aria-selected={w.key === word}
                        className="words-row"
                        onClick={(e) => {
                          if ((e.target as Element).closest("input,button,a")) return;
                          if (selecting) toggle(w.key);
                          else open(w.key, e.currentTarget);
                        }}
                      >
                        {selecting ? (
                          <td className="words-check">
                            <input
                              type="checkbox"
                              aria-label={`Select ${w.lemma}`}
                              checked={selected.has(w.key)}
                              onChange={() => toggle(w.key)}
                            />
                          </td>
                        ) : null}
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
                          <WordStateChip state={w.state} inVuurtoren={w.appLearning} />
                          {w.due !== undefined ? (
                            <span className="words-due">{dueAgo(w.due)}</span>
                          ) : null}
                        </td>
                        <td className={w.gloss ? "words-gloss" : "words-gloss words-gloss--none"}>
                          {w.gloss ?? "No meaning yet"}
                        </td>
                        {columns.recall ? (
                          <td className="k-mono words-col-recall">
                            {w.pKnown === null || w.state !== "learning" ? "–" : pct(w.pKnown)}
                          </td>
                        ) : null}
                        {columns.decks ? (
                          <td className="words-col-decks" title={w.decks.join(", ")}>
                            {w.decks.map(deckName).join(", ")}
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </Fragment>
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

      {selecting && chosen.length > 0 ? (
        <div className="words-bulk" role="region" aria-label="Selected words">
          <span className="words-bulk-count">{chosen.length} selected</span>
          {actions.deckChoice.addDeck ? (
            <AddToAnki
              {...actions.deckChoice.addDeck}
              size="sm"
              {...(bulkAdd.isPending ? { label: "Adding…" } : {})}
              disabled={bulkAdd.isPending}
              onAdd={() => bulkAdd.mutate(chosen)}
            />
          ) : (
            <Button size="sm" disabled={bulkAdd.isPending} onClick={() => bulkAdd.mutate(chosen)}>
              {native ? "Add to my words" : "Add to Anki"}
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
          <Button size="sm" variant="ghost" onClick={stopSelecting}>
            Done
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

/** A level's header row: "Level 1 · 1–500", how many of its words are known, and a thin bar. */
function LevelHeader({
  label,
  progress,
  span,
}: {
  label: string;
  progress: LevelProgress | undefined;
  span: number;
}) {
  const share = progress && progress.size ? progress.known / progress.size : 0;
  return (
    <tr className="words-group">
      <th colSpan={span} scope="colgroup">
        <span className="words-group-label">{label}</span>
        {progress ? (
          <>
            <span className="words-group-count">{progressText(progress)}</span>
            <span
              className="k-meter-track words-group-bar"
              role="meter"
              aria-label={`${label}: known`}
              aria-valuemin={0}
              aria-valuemax={progress.size}
              aria-valuenow={progress.known}
            >
              <span className="k-meter-fill" style={{ width: `${share * 100}%` }} />
            </span>
          </>
        ) : null}
      </th>
    </tr>
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
