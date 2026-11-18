import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  BookOpen,
  FolderPlus,
  ImageIcon,
  Library as LibraryIcon,
  ListChecks,
  MinusCircle,
  Pencil,
  Plus,
  SquareCheck,
  Trash2,
} from "lucide-react";
import { type DragEvent, type KeyboardEvent, type ReactNode, useMemo, useState } from "react";
import { Button, Dialog, EmptyState, Input, Select, Skeleton, useToast } from "@app/ui";
import { useServices } from "../services/context.js";
import type { Shelf } from "../services/libraryTypes.js";
import type { TextListItem } from "../services/types.js";
import { CreateStoryButton } from "./StoryDialog.js";
import { PageHeader } from "../shell/PageHeader.js";
import { ErrorNotice } from "../shell/ErrorNotice.js";
import { CoverDialog } from "./library/CoverDialog.js";
import { DRAG_TYPE, LibraryItem } from "./library/LibraryItem.js";
import { type MenuItem, MenuButton } from "./library/MenuButton.js";
import { AddToShelfDialog, ShelfNameDialog } from "./library/ShelfDialogs.js";
import {
  SORT_LABEL,
  type ShelfRow,
  type SortKey,
  searchTexts,
  shelfRows,
  sortTexts,
} from "./library/shelving.js";
import { TextDetailsDialog } from "./library/TextDetailsDialog.js";
import "./library/library.css";

type View = "shelves" | "all";
const VIEW_KEY = "kenning.library.view";
const SORT_KEY = "kenning.library.sort";

function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode: the choice lasts for this visit only.
  }
}

/** Ids carried by a drag of Library covers, or null for anything else. */
function draggedIds(e: DragEvent): string[] | null {
  try {
    const ids = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as unknown;
    return Array.isArray(ids) && ids.every((x) => typeof x === "string") ? ids : null;
  } catch {
    return null;
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Library: a bookshelf. Rows of covers (Reading now, the learner's shelves, To read, Finished,
 * then by source) that scroll sideways, or every text in a grid; search, sort, multi-select,
 * and per-cover details, cover and shelf actions.
 */
export function Library() {
  const services = useServices();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  const [view, setView] = useState<View>(() => readPref(VIEW_KEY, ["shelves", "all"], "shelves"));
  const [sort, setSort] = useState<SortKey>(() =>
    readPref(SORT_KEY, ["recent", "title", "coverage"], "recent"),
  );
  const [query, setQuery] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const [details, setDetails] = useState<TextListItem | null>(null);
  const [coverFor, setCoverFor] = useState<TextListItem | null>(null);
  const [shelving, setShelving] = useState<{ ids: string[]; label: string }>({
    ids: [],
    label: "",
  });
  const [naming, setNaming] = useState<{ open: boolean; shelf?: Shelf }>({ open: false });
  const [pendingDelete, setPendingDelete] = useState<TextListItem | null>(null);
  const [shelfToDelete, setShelfToDelete] = useState<Shelf | null>(null);

  const texts = useQuery({ queryKey: ["texts"], queryFn: () => services.listTexts() });
  const shelves = useQuery({ queryKey: ["shelves"], queryFn: () => services.shelves() });
  const summary = useQuery({ queryKey: ["learner"], queryFn: () => services.learnerSummary() });

  const remove = useMutation({
    mutationFn: (id: string) => services.deleteText(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["texts"] });
      toast("Text deleted");
    },
    onError: (e) =>
      toast("Could not delete the text", e instanceof Error ? e.message : "Try again."),
  });
  const dropShelf = useMutation({
    mutationFn: (id: string) => services.deleteShelf(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["shelves"] });
      toast("Shelf deleted", "Its texts are still in your library.");
    },
    onError: (e) => toast("Could not delete the shelf", e instanceof Error ? e.message : ""),
  });
  const shelve = useMutation({
    mutationFn: async (a: { shelf: { id: string; name: string }; ids: string[]; add: boolean }) => {
      if (a.add) await services.addToShelf(a.shelf.id, a.ids);
      else await services.removeFromShelf(a.shelf.id, a.ids);
    },
    onSuccess: async (_r, a) => {
      await qc.invalidateQueries({ queryKey: ["shelves"] });
      toast(
        a.add ? `Added to "${a.shelf.name}"` : `Removed from "${a.shelf.name}"`,
        a.ids.length > 1 ? plural(a.ids.length, "text", "texts") : undefined,
      );
    },
    onError: (e) => toast("Could not change the shelf", e instanceof Error ? e.message : ""),
  });

  const all = useMemo(() => sortTexts(texts.data ?? [], sort), [texts.data, sort]);
  const found = useMemo(() => searchTexts(all, query), [all, query]);
  const ownShelves = useMemo(() => shelves.data ?? [], [shelves.data]);
  const rows = useMemo(() => shelfRows(all, ownShelves), [all, ownShelves]);

  const needsAnki = summary.data != null && summary.data.lastSync === null;
  const searching = query.trim() !== "";

  const toggleSelected = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const open = (t: TextListItem) => {
    if (selecting) toggleSelected(t.id);
    else void navigate({ to: "/read/$textId", params: { textId: t.id } });
  };

  const menuFor = (t: TextListItem, row?: ShelfRow): MenuItem[] => [
    { label: "Open", icon: <BookOpen size={16} aria-hidden />, onSelect: () => open(t) },
    {
      label: "Words from this text",
      icon: <ListChecks size={16} aria-hidden />,
      onSelect: () => void navigate({ to: "/read/$textId/words", params: { textId: t.id } }),
    },
    {
      label: "Edit details…",
      icon: <Pencil size={16} aria-hidden />,
      onSelect: () => setDetails(t),
    },
    {
      label: "Change cover…",
      icon: <ImageIcon size={16} aria-hidden />,
      onSelect: () => setCoverFor(t),
    },
    {
      label: "Add to shelf…",
      icon: <FolderPlus size={16} aria-hidden />,
      onSelect: () => setShelving({ ids: [t.id], label: t.title }),
    },
    ...(row?.own
      ? [
          {
            label: `Remove from "${row.name}"`,
            icon: <MinusCircle size={16} aria-hidden />,
            onSelect: () => shelve.mutate({ shelf: row, ids: [t.id], add: false }),
          },
        ]
      : []),
    {
      label: "Delete…",
      icon: <Trash2 size={16} aria-hidden />,
      danger: true,
      onSelect: () => setPendingDelete(t),
    },
  ];

  const item = (
    t: TextListItem,
    variant: "shelf" | "grid",
    row?: ShelfRow,
    extra: Partial<
      Pick<Parameters<typeof LibraryItem>[0], "tabIndex" | "onFocus" | "onKeyDown">
    > = {},
  ) => (
    <LibraryItem
      key={t.id}
      text={t}
      variant={variant}
      menu={menuFor(t, row)}
      onOpen={() => open(t)}
      selecting={selecting}
      selected={selected.has(t.id)}
      dragIds={() => (selected.has(t.id) ? [...selected] : [t.id])}
      {...extra}
    />
  );

  const grid = (list: TextListItem[]) => (
    <ul className="shelf lib-grid" aria-label="All texts">
      {list.map((t) => item(t, "grid"))}
    </ul>
  );

  let body: ReactNode;
  if (texts.isPending) {
    body = (
      <div className="shelf" aria-busy>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} style={{ aspectRatio: "4 / 5", borderRadius: 12 }} />
        ))}
      </div>
    );
  } else if (texts.isError) {
    body = (
      <ErrorNotice
        title="The library could not be loaded."
        error={texts.error}
        onRetry={() => void texts.refetch()}
      />
    );
  } else if (texts.data.length === 0) {
    body = (
      <EmptyState
        icon={<LibraryIcon size={28} />}
        title="Your library is empty"
        description="Paste a text, add a web page, or upload a PDF or photo to start reading."
        action={
          <Button variant="primary" onClick={() => void navigate({ to: "/import" })}>
            Import a text
          </Button>
        }
      />
    );
  } else if (searching) {
    body = (
      <>
        <p className="lib-count" role="status">
          {found.length === 0
            ? "No texts match."
            : `${plural(found.length, "text matches", "texts match")}`}
        </p>
        {found.length ? grid(found) : null}
      </>
    );
  } else if (view === "all") {
    body = grid(all);
  } else {
    const firstSource = rows.findIndex((r) => r.group === "source");
    body = rows.map((row, i) => {
      const shelf = ownShelves.find((s) => s.id === row.id);
      return (
        <ShelfRowView
          key={row.id}
          row={row}
          sourceHeading={i === firstSource}
          renderItem={(t, extra) => item(t, "shelf", row, extra)}
          shelfMenu={
            shelf
              ? [
                  {
                    label: "Rename…",
                    icon: <Pencil size={16} aria-hidden />,
                    onSelect: () => setNaming({ open: true, shelf }),
                  },
                  {
                    label: "Delete shelf…",
                    icon: <Trash2 size={16} aria-hidden />,
                    danger: true,
                    onSelect: () => setShelfToDelete(shelf),
                  },
                ]
              : null
          }
          onDropTexts={shelf ? (ids) => shelve.mutate({ shelf, ids, add: true }) : undefined}
        />
      );
    });
  }

  return (
    <div className="page library" data-selecting={selecting ? "" : undefined}>
      <PageHeader
        title="Library"
        lede="Your bookshelf: texts on shelves, with how much of each you already know."
        actions={
          <>
            <CreateStoryButton />
            <Link to="/import" className="k-btn k-btn--primary">
              <Plus size={16} aria-hidden /> Import text
            </Link>
          </>
        }
      />

      {needsAnki ? (
        <div className="banner" role="note">
          <span>Connect Anki and Kenning can tell how much of each text you already know.</span>
          <Button variant="secondary" onClick={() => void navigate({ to: "/settings" })}>
            Connect Anki
          </Button>
        </div>
      ) : null}

      {texts.data && texts.data.length > 0 ? (
        <div className="lib-toolbar" role="group" aria-label="Library view">
          <div className="lib-seg" role="radiogroup" aria-label="View">
            {(["shelves", "all"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={view === v}
                className="lib-seg-btn"
                onClick={() => {
                  setView(v);
                  writePref(VIEW_KEY, v);
                }}
              >
                {v === "shelves" ? "Shelves" : "All texts"}
              </button>
            ))}
          </div>
          <div className="lib-toolbar-fields">
            <div className="lib-search">
              <Input
                label="Search"
                type="search"
                value={query}
                placeholder="Title, author, note"
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="lib-sort">
              <Select
                label="Sort"
                value={sort}
                onValueChange={(v) => {
                  setSort(v as SortKey);
                  writePref(SORT_KEY, v);
                }}
                options={(Object.keys(SORT_LABEL) as SortKey[]).map((k) => ({
                  value: k,
                  label: SORT_LABEL[k],
                }))}
              />
            </div>
            <div className="lib-toolbar-buttons">
              <Button
                variant="ghost"
                aria-label="New shelf"
                onClick={() => setNaming({ open: true })}
              >
                <FolderPlus size={16} aria-hidden /> <span className="lib-wide">New shelf</span>
              </Button>
              <button
                type="button"
                className="k-toggle"
                aria-pressed={selecting}
                onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
              >
                <SquareCheck size={14} aria-hidden /> Select
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {body}

      {selecting ? (
        <div
          className="lib-bulk"
          role="region"
          aria-label="Selection"
          onKeyDown={(e: KeyboardEvent) => {
            if (e.key === "Escape") stopSelecting();
          }}
        >
          <span className="lib-bulk-count" role="status">
            {selected.size === 0
              ? "Tap covers to select them"
              : `${plural(selected.size, "text", "texts")} selected`}
          </span>
          <Button
            variant="primary"
            size="sm"
            disabled={selected.size === 0}
            onClick={() =>
              setShelving({ ids: [...selected], label: plural(selected.size, "text", "texts") })
            }
          >
            <FolderPlus size={16} aria-hidden /> Add to shelf
          </Button>
          <Button variant="ghost" size="sm" onClick={stopSelecting}>
            Done
          </Button>
        </div>
      ) : null}

      <TextDetailsDialog text={details} onClose={() => setDetails(null)} />
      <CoverDialog text={coverFor} onClose={() => setCoverFor(null)} />
      <AddToShelfDialog
        textIds={shelving.ids}
        label={shelving.label}
        shelves={ownShelves}
        onClose={() => setShelving({ ids: [], label: "" })}
      />
      <ShelfNameDialog
        open={naming.open}
        shelf={naming.shelf}
        onClose={() => setNaming({ open: false })}
      />

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDelete(null);
        }}
        title="Delete this text"
        description={
          pendingDelete ? `"${pendingDelete.title}" will be removed from your library.` : ""
        }
      >
        <div className="k-dialog-actions">
          <Button variant="ghost" onClick={() => setPendingDelete(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (pendingDelete) remove.mutate(pendingDelete.id);
              setPendingDelete(null);
            }}
          >
            Delete
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={shelfToDelete !== null}
        onOpenChange={(o) => {
          if (!o) setShelfToDelete(null);
        }}
        title="Delete this shelf"
        description={
          shelfToDelete
            ? `"${shelfToDelete.name}" will be removed. Its texts stay in your library.`
            : ""
        }
      >
        <div className="k-dialog-actions">
          <Button variant="ghost" onClick={() => setShelfToDelete(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (shelfToDelete) dropShelf.mutate(shelfToDelete.id);
              setShelfToDelete(null);
            }}
          >
            Delete shelf
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

interface RovingProps {
  tabIndex: number;
  onFocus: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
}

/**
 * One bookshelf row: a header (name, count, the shelf's menu) and covers that scroll sideways
 * with snap. Arrow keys move between covers (one tab stop per row). A learner shelf accepts
 * dropped covers.
 */
function ShelfRowView({
  row,
  sourceHeading,
  renderItem,
  shelfMenu,
  onDropTexts,
}: {
  row: ShelfRow;
  sourceHeading: boolean;
  renderItem: (t: TextListItem, extra: RovingProps) => ReactNode;
  shelfMenu: MenuItem[] | null;
  onDropTexts?: ((ids: string[]) => void) | undefined;
}) {
  const [active, setActive] = useState(0);
  const [over, setOver] = useState(false);
  const headingId = `shelf-${row.id.replace(/[^\w-]/g, "-")}`;
  const current = Math.min(active, Math.max(0, row.texts.length - 1));

  const focusAt = (from: HTMLElement, i: number) => {
    const buttons = from.closest(".lib-row")?.querySelectorAll<HTMLElement>(".lib-open");
    if (!buttons?.length) return;
    const j = Math.max(0, Math.min(buttons.length - 1, i));
    setActive(j);
    buttons[j]?.focus();
    buttons[j]?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  };
  const keyFor = (i: number) => (e: KeyboardEvent<HTMLButtonElement>) => {
    const moves: Record<string, number> = {
      ArrowRight: i + 1,
      ArrowLeft: i - 1,
      Home: 0,
      End: row.texts.length - 1,
    };
    const to = moves[e.key];
    if (to === undefined) return;
    e.preventDefault();
    focusAt(e.currentTarget, to);
  };

  const dropProps = onDropTexts
    ? {
        onDragOver: (e: DragEvent) => {
          if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setOver(true);
        },
        onDragLeave: (e: DragEvent) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
        },
        onDrop: (e: DragEvent) => {
          setOver(false);
          const ids = draggedIds(e);
          if (!ids?.length) return;
          e.preventDefault();
          onDropTexts(ids);
        },
      }
    : {};

  return (
    <>
      {sourceHeading ? <p className="k-overline lib-group-label">By source</p> : null}
      <section
        className="lib-shelf"
        aria-labelledby={headingId}
        data-own={row.own ? "" : undefined}
        data-drop={over ? "" : undefined}
        {...dropProps}
      >
        <header className="lib-shelf-head">
          <h2 className="lib-shelf-title" id={headingId}>
            {row.name}
          </h2>
          <span className="lib-shelf-count">{plural(row.texts.length, "text", "texts")}</span>
          {shelfMenu ? (
            <MenuButton className="lib-shelf-menu" label={`Shelf ${row.name}`} items={shelfMenu} />
          ) : null}
        </header>
        {row.texts.length ? (
          <ul className="lib-row" aria-labelledby={headingId}>
            {row.texts.map((t, i) =>
              renderItem(t, {
                tabIndex: i === current ? 0 : -1,
                onFocus: () => setActive(i),
                onKeyDown: keyFor(i),
              }),
            )}
          </ul>
        ) : (
          <p className="lib-shelf-empty">
            Nothing here yet. Choose “Add to shelf…” in a cover’s menu, or drag covers here.
          </p>
        )}
      </section>
    </>
  );
}
