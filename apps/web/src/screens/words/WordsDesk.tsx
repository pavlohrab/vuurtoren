/**
 * Words on a computer, as mock "Words, round 2" A (Inbox; `.plan/mocks/mock-words-desktop-2.html`):
 * like a mail app. Left, Due today on top of folders: the states, the levels with thin bars,
 * the texts. Middle, the words of the chosen folder as a two-line list with a checkbox on every
 * row and a dark bar for the selected words. Right, a wide pane for the chosen word: for a new
 * word you decide (Add to my words or I know it: keys A, K) and the next one opens; for
 * any other word its reviews and next review. Open word card puts the whole card in the pane.
 * Phones keep the list page (`Words`).
 */
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { starterBand } from "@app/anki";
import type { InspectorEntry } from "@app/core";
import { frequencyLabel } from "@app/core";
import { Lemma, Popover, Skeleton, WordInspector, useNativeMode, useToast } from "@app/ui";
import { ChevronDown, ChevronLeft, ChevronUp, Search } from "lucide-react";
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";
import { plural } from "../../format.js";
import { useServices } from "../../services/context.js";
import { errorText } from "../../services/errors.js";
import type { KnownUndo } from "../../services/types.js";
import { useDebounced } from "../../useDebounced.js";
import { writeLocalJSON } from "../../storage/local.js";
import { useWordActions } from "../useWordActions.js";
import { levelLabel, levelOf, parseLevel } from "./levels.js";
import {
  COLUMNS_KEY,
  PAGE_SIZE,
  type WordColumns,
  type WordRow,
  type WordsSearch,
  type WordsView,
  loadLevelRows,
  loadRows,
  nextIn,
  parseSource,
  parseView,
  readColumns,
} from "./Words.js";
import { ALL_WORDS, loadStarterIndex, useLevelProgress } from "./WordsRoom.js";
import "./wordsDesk.css";

const DAY_MS = 86_400_000;
const fmt = (n: number) => n.toLocaleString("en");

/** The folders of the states, in the mock's order. */
const FOLDERS: { id: WordsView; label: string; native?: true }[] = [
  { id: "decide", label: "To decide" },
  { id: "due", label: "Due", native: true },
  { id: "new", label: "New" },
  { id: "learning", label: "Learning" },
  { id: "known", label: "Known" },
  { id: "ignored", label: "Ignored" },
  { id: "all", label: "All" },
];

/** A word still to decide on: met while reading, no card, no decision. */
const toDecide = (r: { state: string; hasCard?: boolean | undefined }) =>
  (r.state === "unknown" || r.state === "seen") && !r.hasCard;

export function WordsDesk() {
  const services = useServices();
  const toast = useToast();
  const native = useNativeMode();
  const qc = useQueryClient();
  const params: WordsSearch = useSearch({ from: "/words/all" });
  const navigate = useNavigate();

  const source = parseSource(params.source);
  const view = parseView(params.state);
  const setSearch = (patch: Partial<Record<keyof WordsSearch, string | undefined>>) => {
    const next: Record<string, string | undefined> = { ...params, ...patch };
    // Always "list": with no filter left, the Inbox stays (Words() would show the cards).
    const clean: WordsSearch = { layout: "list" };
    for (const k of ["state", "source", "level", "q", "word"] as const)
      if (next[k]) clean[k] = next[k];
    void navigate({ to: "/words/all", search: clean, replace: true });
  };

  // Search as the learner pauses typing; "/" goes to the field.
  const [draft, setDraft] = useState(params.q ?? "");
  const search = useDebounced(draft.trim(), 250);
  useEffect(() => {
    if ((params.q ?? "") !== search) setSearch({ q: search || undefined });
    // Only the debounced value drives the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
  const searchRef = useRef<HTMLInputElement>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [columns, setColumns] = useState<WordColumns>(readColumns);
  const toggleColumn = (k: keyof WordColumns) =>
    setColumns((c) => {
      const next = { ...c, [k]: !c[k] };
      writeLocalJSON(COLUMNS_KEY, next);
      return next;
    });
  /** Open a folder: a state, a level or a text (one at a time, as folders are). */
  const openFolder = (patch: Partial<Record<keyof WordsSearch, string | undefined>>) => {
    setLimit(PAGE_SIZE);
    setSelected(new Set());
    setFull(false);
    setSearch({ state: undefined, level: undefined, source: undefined, word: undefined, ...patch });
  };

  const index = useQuery({
    queryKey: ["starter-index"],
    queryFn: loadStarterIndex,
    staleTime: Infinity,
  });
  const level = parseLevel(params.level, index.data);
  const rows = useQuery({
    queryKey: ["words", "desk", params.source ?? null, view, params.q ?? "", limit, level],
    queryFn: async () =>
      level !== null
        ? loadLevelRows(
            services,
            source,
            { view, query: params.q, limit },
            await loadStarterIndex(),
            { only: level, grouped: false },
          )
        : loadRows(services, source, { view, query: params.q, limit }),
    placeholderData: keepPreviousData,
  });
  // How many words each folder holds.
  const counts = useQuery({
    queryKey: ["words", "desk-counts", native],
    queryFn: async () => {
      const [all, decide, due] = await Promise.all([
        services.words({ limit: ALL_WORDS }),
        services.wordsToDecide({ limit: ALL_WORDS }),
        native ? services.dueWords({ limit: ALL_WORDS }) : Promise.resolve([]),
      ]);
      const by = (s: string) => all.filter((w) => w.state === s).length;
      return {
        decide: decide.length,
        due: due.length,
        new: by("unknown") + by("seen"),
        learning: by("learning"),
        known: by("known"),
        ignored: by("ignored"),
        all: all.length,
      } as Record<WordsView, number>;
    },
    staleTime: 15_000,
  });
  const today = useQuery({
    queryKey: ["review", "overview"],
    queryFn: () => services.reviewOverview(),
    enabled: native,
  });
  const progress = useLevelProgress();
  const next = useQuery({
    queryKey: ["words", "next-reviews"],
    queryFn: () => services.nextReviews(),
    enabled: native,
    staleTime: 30_000,
  });
  const texts = useQuery({ queryKey: ["texts"], queryFn: () => services.listTexts() });
  const list = rows.data ?? [];

  // The chosen word: the one in the URL, else the first row, so the pane is never empty.
  const chosenKey = list.some((r) => r.key === params.word) ? params.word : list[0]?.key;
  const at = list.findIndex((r) => r.key === chosenKey);
  const row = at >= 0 ? list[at] : undefined;
  const after = at >= 0 ? list[at + 1] : undefined;
  const inspect = useQuery({
    queryKey: ["inspect-word", chosenKey],
    queryFn: () => services.inspectWord(chosenKey!),
    enabled: Boolean(chosenKey) && !row?.entry,
  });
  const entry: InspectorEntry | null = row?.entry ?? (chosenKey ? (inspect.data ?? null) : null);
  const actions = useWordActions("reading");
  const [full, setFull] = useState(false);

  const refresh = () => {
    for (const k of ["words", "inspect-word", "texts", "learner", "home", "textWords", "review"])
      void qc.invalidateQueries({ queryKey: [k] });
  };
  /** Decide on words: add them, or say you know them. */
  const decide = useMutation({
    mutationFn: async ({ keys, how }: { keys: string[]; how: "add" | "know" }) => {
      const opts = actions.deckChoice.chosen ? { deck: actions.deckChoice.chosen } : undefined;
      let done = 0;
      // What Undo needs for each word marked known.
      const undos: { key: string; undo?: KnownUndo | undefined }[] = [];
      for (const key of keys) {
        const r = list.find((x) => x.key === key);
        const e = r?.entry ?? (await services.inspectWord(key));
        if (how === "add") {
          if (e.anki.status !== "absent") continue;
          await services.addToAnki(e, opts);
        } else {
          const { undo } = await services.markKnown(e, opts);
          undos.push({ key, undo });
        }
        done++;
      }
      return { done, how, undos };
    },
    onSuccess: ({ done, how, undos }, { keys }) => {
      if (how === "add") {
        if (keys.length > 1) toast(`Added ${plural(done, "word")}`);
      } else {
        // Undo on the toast (the list moves on, so the card can't show it), where it really
        // undoes: your own cards. Anki's cards change in Anki.
        const canUndo = undos.length > 0 && undos.every((u) => u.undo) && !!services.undoKnown;
        toast(
          done === 1 ? "Marked as known" : `${plural(done, "word")} known`,
          undefined,
          canUndo ? { label: "Undo", onAct: () => unknow.mutate(undos) } : undefined,
        );
      }
      setSelected(new Set());
      // The next word opens.
      if (keys.length === 1 && keys[0] === chosenKey && after) setSearch({ word: after.key });
      refresh();
    },
    onError: (e) => toast("Could not change the words", errorText(e)),
  });
  /** Undo of "I know it" from the list (your own cards: each card's earlier state). */
  const unknow = useMutation({
    mutationFn: async (undos: { key: string; undo?: KnownUndo | undefined }[]) => {
      for (const u of undos) if (u.undo) await services.undoKnown!(u.undo);
    },
    onSuccess: () => {
      toast("Not marked as known any more");
      refresh();
    },
    onError: (e) => toast("Could not undo", errorText(e)),
  });

  const move = (by: 1 | -1) => {
    const to = list[at + by];
    if (to) {
      setFull(false);
      setSearch({ word: to.key });
    }
  };
  const deciding = !!row && toDecide(row);
  // Keys: A and K decide; ↑ and ↓ move through the list; "/" goes to the search.
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest("input,textarea,select,[contenteditable]")) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "/") {
      e.preventDefault();
      searchRef.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (deciding && chosenKey && !decide.isPending && !full) {
      const how = { a: "add", k: "know" }[e.key.toLowerCase()] as "add" | "know" | undefined;
      if (how) {
        e.preventDefault();
        decide.mutate({ keys: [chosenKey], how });
      }
    }
  };

  const bandOf = (key: string): string => {
    const l = index.data ? levelOf(index.data, key) : null;
    return l === null ? "–" : starterBand(l);
  };
  const textTitle = (id: string | undefined) =>
    id ? texts.data?.find((t) => t.id === id)?.title : undefined;
  const sourceTitle =
    source?.kind === "text"
      ? (textTitle(source.textId) ?? "A text")
      : source?.kind === "unit"
        ? "A course unit"
        : source?.kind === "practice-again"
          ? "Last practice session"
          : null;
  const folder =
    sourceTitle ??
    (level !== null && index.data
      ? levelLabel(index.data, level === "other" ? null : level)
      : view === "all"
        ? "All words"
        : (FOLDERS.find((f) => f.id === view)?.label ?? "Words"));
  const total = view === "all" && level === null && !source ? counts.data?.all : undefined;
  const subtitle =
    view === "decide"
      ? `${plural(counts.data?.decide ?? list.length, "new word")} you met while reading`
      : view === "due"
        ? `${plural(counts.data?.due ?? list.length, "card")} due now`
        : `${plural(total ?? list.length, "word")}${list.length >= limit && total === undefined ? "+" : ""}`;
  const fromTexts = (texts.data ?? [])
    .filter((t) => (t.newTypes ?? 0) > 0)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 6);
  const chosen = list.filter((r) => selected.has(r.key));
  const due = today.data ? today.data.due + today.data.fresh : undefined;

  return (
    <div className="wd-a" onKeyDown={onKey}>
      {/* Left: today on top of the folders. */}
      <nav className="wd-rail" aria-label="Your words">
        {native ? (
          <section className="wd-today" aria-labelledby="wd-today-h">
            <h2 id="wd-today-h" className="wd-over">
              Due today
            </h2>
            <p className="wd-today-row">
              <span className="wd-today-n">{due === undefined ? "…" : fmt(due)}</span>
              {today.data ? (
                <span className="wd-muted">
                  {plural(today.data.due, "review")} · {fmt(today.data.fresh)} new
                </span>
              ) : null}
            </p>
            <Link to="/review" className="k-btn k-btn--primary wd-wide">
              Start review
            </Link>
            <Link to="/practice" className="wd-ghost">
              Practise these words
            </Link>
          </section>
        ) : (
          <section className="wd-today">
            <h2 className="wd-over">Reviews</h2>
            <p className="wd-muted" style={{ margin: 0 }}>
              You review your cards in Anki. Words you add go to your Anki deck.
            </p>
            <Link to="/practice" className="wd-ghost">
              Practise these words
            </Link>
          </section>
        )}

        <div className="wd-grp">
          <h2 className="wd-over wd-gh">Words</h2>
          {FOLDERS.filter(
            // Nothing ignores a word any more: the folder is there only for old ones.
            (f) => (!f.native || native) && (f.id !== "ignored" || (counts.data?.ignored ?? 0) > 0),
          ).map((f) => {
            const on = view === f.id && level === null && !source;
            const n = counts.data?.[f.id];
            return (
              <button
                key={f.id}
                type="button"
                className="wd-ni"
                aria-current={on ? "true" : undefined}
                onClick={() => openFolder({ state: f.id === "all" ? undefined : f.id })}
              >
                <span>{f.label}</span>
                {n === undefined ? null : f.id === "decide" && n > 0 ? (
                  <span className="wd-pill">{fmt(n)}</span>
                ) : (
                  <span className="wd-c">{fmt(n)}</span>
                )}
              </button>
            );
          })}
        </div>

        {index.data && progress.data?.length ? (
          <div className="wd-grp">
            <div className="wd-gh">
              <h2 className="wd-over">Levels</h2>
              <Link to="/words/all" search={{ layout: "cards" }} className="wd-gh-link">
                Check your level
              </Link>
            </div>
            {progress.data.map((p) => (
              <button
                key={p.level}
                type="button"
                className="wd-lv"
                aria-current={level === p.level ? "true" : undefined}
                onClick={() => openFolder({ level: String(p.level) })}
              >
                <b>{levelLabel(index.data, p.level)}</b>
                <span className="wd-sb" aria-hidden>
                  <i className="k" style={{ width: `${(100 * p.known) / Math.max(1, p.size)}%` }} />
                  <i
                    className="l"
                    style={{ width: `${(100 * p.learning) / Math.max(1, p.size)}%` }}
                  />
                </span>
                <span className="wd-c">
                  {fmt(p.known)}/{fmt(p.size)}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {fromTexts.length ? (
          <div className="wd-grp">
            <h2 className="wd-over wd-gh">From texts</h2>
            {fromTexts.map((t) => (
              <button
                key={t.id}
                type="button"
                className="wd-ni"
                aria-current={
                  source?.kind === "text" && source.textId === t.id ? "true" : undefined
                }
                onClick={() => openFolder({ source: `text:${t.id}` })}
              >
                <span className="wd-ellipsis">{t.title}</span>
                <span className="wd-c">{fmt(t.newTypes ?? 0)}</span>
              </button>
            ))}
          </div>
        ) : null}
      </nav>

      {/* Middle: the folder's words. */}
      <section className="wd-list" aria-labelledby="wd-folder">
        <label className="wd-search">
          <Search size={15} aria-hidden />
          <span className="k-sr">Search</span>
          <input
            ref={searchRef}
            type="search"
            value={draft}
            placeholder="Search all words or meanings"
            onChange={(e) => {
              setDraft(e.target.value);
              setLimit(PAGE_SIZE);
            }}
          />
          <kbd className="wd-kbd" aria-hidden>
            /
          </kbd>
        </label>
        <div className="wd-hd">
          <h1 id="wd-folder">{folder}</h1>
          <span className="wd-muted">{subtitle}</span>
          <Popover
            align="end"
            label="Columns"
            className="words-columns"
            trigger={
              <button type="button" className="wd-btn wd-btn--sm">
                Columns
              </button>
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
        </div>

        {rows.isPending ? (
          <Skeleton style={{ height: 320, borderRadius: 14 }} />
        ) : rows.isError ? (
          <p role="alert" className="error-text">
            Your words could not be loaded. {errorText(rows.error)}
          </p>
        ) : list.length === 0 ? (
          <div className="wd-empty">
            {view === "decide"
              ? "Nothing to decide. New words from your texts come here as you read."
              : params.q
                ? "No words match."
                : "No words here yet."}
          </div>
        ) : (
          <ul className="wd-wlist" aria-label={folder}>
            {list.map((w) => {
              const on = w.key === chosenKey;
              const nextAt = next.data?.[w.key];
              // The second line says what the folder doesn't already say.
              const stateLine = toDecide(w)
                ? "To decide"
                : w.state === "learning" && nextAt !== undefined
                  ? `Next ${nextIn(nextAt)}`
                  : w.state === "known"
                    ? "Known"
                    : w.state === "learning"
                      ? "Learning"
                      : w.state === "ignored"
                        ? "Ignored"
                        : "New";
              const second =
                source?.kind === "text"
                  ? sourceTitle
                  : stateLine === (FOLDERS.find((f) => f.id === view)?.label ?? "") ||
                      (view === "new" && stateLine === "New")
                    ? null
                    : stateLine;
              return (
                <li
                  key={w.key}
                  className="wd-wrow"
                  aria-current={on ? "true" : undefined}
                  onClick={(e) => {
                    if ((e.target as Element).closest("input")) return;
                    setFull(false);
                    setSearch({ word: w.key });
                  }}
                >
                  <input
                    type="checkbox"
                    aria-label={`Select ${w.lemma}`}
                    checked={selected.has(w.key)}
                    onChange={() =>
                      setSelected((s) => {
                        const n = new Set(s);
                        if (n.has(w.key)) n.delete(w.key);
                        else n.add(w.key);
                        return n;
                      })
                    }
                  />
                  <button
                    type="button"
                    className="wd-wbody"
                    aria-label={`Open ${w.lemma}`}
                    onClick={() => {
                      setFull(false);
                      setSearch({ word: w.key });
                    }}
                  >
                    <span className="wd-wd">
                      <Lemma lemma={w.lemma} article={w.article} />
                    </span>
                    <span className="wd-mn">{w.gloss ?? "–"}</span>
                  </button>
                  <span className="wd-meta">
                    <b>{bandOf(w.key)}</b>
                    {second ? <span>{second}</span> : null}
                    {columns.recall && w.state === "learning" && w.pKnown !== null ? (
                      <span>Recall {Math.round(w.pKnown * 100)}%</span>
                    ) : null}
                    {columns.decks && w.decks.length ? (
                      <span>{w.decks.map((d) => d.split("::").pop()).join(", ")}</span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {!source && list.length >= limit ? (
          <button
            type="button"
            className="wd-ghost wd-more"
            onClick={() => setLimit((l) => l + PAGE_SIZE)}
          >
            Show more
          </button>
        ) : null}

        {chosen.length ? (
          <div className="wd-selbar" role="region" aria-label="Selected words">
            <span>{chosen.length} selected</span>
            <button
              type="button"
              disabled={decide.isPending}
              onClick={() => decide.mutate({ keys: chosen.map((r) => r.key), how: "add" })}
            >
              {native ? "Add to my words" : "Add to Anki"}
            </button>
            <button
              type="button"
              disabled={decide.isPending}
              onClick={() => decide.mutate({ keys: chosen.map((r) => r.key), how: "know" })}
            >
              I know them
            </button>
            <button type="button" className="wd-clear" onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </div>
        ) : null}
      </section>

      {/* Right: the chosen word. */}
      <aside className="wd-pane" aria-label="The chosen word">
        {!chosenKey ? null : full ? (
          <div className="wd-full">
            <button type="button" className="wd-ghost wd-back" onClick={() => setFull(false)}>
              <ChevronLeft size={15} aria-hidden /> Back
            </button>
            <WordInspector
              entry={entry}
              loading={!entry && !inspect.isError}
              error={inspect.isError ? errorText(inspect.error) : null}
              onRetry={() => void inspect.refetch()}
              emptyText="Select a word to see its details."
              {...actions.props(entry)}
            />
          </div>
        ) : (
          <WordPane
            entry={entry}
            row={row}
            folder={folder}
            at={at}
            count={
              level === null && !source && !params.q && counts.data
                ? counts.data[view]
                : list.length
            }
            band={bandOf(chosenKey)}
            nextAt={next.data?.[chosenKey]}
            textTitle={textTitle(entry?.textId)}
            deciding={deciding}
            busy={decide.isPending}
            after={after?.lemma}
            onMove={move}
            onDecide={(how) => decide.mutate({ keys: [chosenKey], how })}
            onOpen={() => setFull(true)}
          />
        )}
      </aside>
    </div>
  );
}

/** Review squares: a rating's colour (Again, Hard, Good, Easy). */
const RATING_TONE = ["", "again", "hard", "good", "easy"] as const;

/** The chosen word in the pane: the decide card for a new word, else its reviews. */
function WordPane({
  entry,
  row,
  folder,
  at,
  count,
  band,
  nextAt,
  textTitle,
  deciding,
  busy,
  after,
  onMove,
  onDecide,
  onOpen,
}: {
  entry: InspectorEntry | null;
  row: WordRow | undefined;
  folder: string;
  at: number;
  count: number;
  band: string;
  nextAt: number | undefined;
  textTitle: string | undefined;
  deciding: boolean;
  busy: boolean;
  after: string | undefined;
  onMove: (by: 1 | -1) => void;
  onDecide: (how: "add" | "know") => void;
  onOpen: () => void;
}) {
  // When the pane opened: "learning for 6 days" counts from here.
  const [now] = useState(() => Date.now());
  const nav = (
    <div className="wd-nav">
      <span className="wd-over">
        {folder} · {at + 1} of {fmt(Math.max(count, at + 1))}
      </span>
      <span className="wd-arrows">
        <button type="button" aria-label="Previous word" onClick={() => onMove(-1)}>
          <ChevronUp size={15} aria-hidden />
        </button>
        <button type="button" aria-label="Next word" onClick={() => onMove(1)}>
          <ChevronDown size={15} aria-hidden />
        </button>
      </span>
    </div>
  );
  if (!entry) {
    return (
      <>
        {nav}
        <Skeleton style={{ height: 300, borderRadius: 12 }} />
      </>
    );
  }
  // The word's kind ("noun"); a placeholder kind (X, SYM) says nothing.
  const kind =
    entry.pos && !["X", "SYM", "PUNCT", "SPACE"].includes(entry.pos.toUpperCase())
      ? entry.pos.toLowerCase().replace("propn", "name")
      : "";
  const meaning = entry.glosses[0] ?? row?.gloss;
  const [hs, he] = entry.sentenceHighlight ?? [0, 0];
  const s = entry.sentence?.trim() ? entry.sentence : "";
  const reviews = (entry.anki.reviews ?? []).slice(-10);
  const first = entry.anki.reviews?.[0]?.at;
  const days = first ? Math.max(1, Math.round((now - first) / DAY_MS)) : null;
  const sub = [frequencyLabel(entry.zipf), band !== "–" ? `about ${band}` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      {nav}
      <div>
        <h2 className="wd-hw" lang="nl">
          {entry.article ? `${entry.article} ` : ""}
          {entry.lemma}
          {kind ? <small>{kind}</small> : null}
        </h2>
        {/* How common it is (from your texts) beside its level, as on the word card (LV9). */}
        {sub ? <p className="wd-muted wd-sub">{sub}</p> : null}
      </div>
      <p className="wd-mean">{meaning ?? "No meaning yet"}</p>
      {s ? (
        <blockquote className="wd-quote">
          <span className="wd-sent" lang="nl">
            {he > hs ? (
              <>
                {s.slice(0, hs)}
                <mark>{s.slice(hs, he)}</mark>
                {s.slice(he)}
              </>
            ) : (
              s
            )}
          </span>
          {entry.sentenceTranslation ? <small>{entry.sentenceTranslation}</small> : null}
          {textTitle ? <small>{textTitle}</small> : null}
        </blockquote>
      ) : null}
      {deciding ? (
        <div className="wd-dbtns">
          <button
            type="button"
            className="wd-dbtn wd-dbtn--pri"
            disabled={busy}
            onClick={() => onDecide("add")}
          >
            <span>Add to my words</span>
            <kbd className="wd-kbd">A</kbd>
          </button>
          <button
            type="button"
            className="wd-dbtn"
            disabled={busy}
            onClick={() => onDecide("know")}
          >
            <span>I know it</span>
            <kbd className="wd-kbd">K</kbd>
          </button>
        </div>
      ) : (
        <div className="wd-review">
          {reviews.length ? (
            <div className="wd-reviews">
              <span className="wd-over">Reviews</span>
              <span className="wd-squares" aria-label={plural(reviews.length, "review")}>
                {reviews.map((r, k) => (
                  <span key={k} data-tone={RATING_TONE[r.rating]} />
                ))}
              </span>
            </div>
          ) : null}
          {nextAt !== undefined || (days && entry.state === "learning") ? (
            <p className="wd-muted wd-next">
              {nextAt !== undefined ? `Next review ${nextIn(nextAt)}.` : null}
              {days && entry.state === "learning" ? ` Learning for ${plural(days, "day")}.` : null}
            </p>
          ) : null}
          {entry.state !== "known" ? (
            <button
              type="button"
              className="wd-ghost"
              disabled={busy}
              onClick={() => onDecide("know")}
            >
              Mark known
            </button>
          ) : null}
        </div>
      )}
      <div className="wd-foot">
        <span>{deciding && after ? `Then ${after} opens.` : ""}</span>
        <button type="button" className="wd-ghost" onClick={onOpen}>
          Open word card
        </button>
      </div>
    </>
  );
}
