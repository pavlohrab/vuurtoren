/** Pure Library logic: search, sort and the shelves (the learner's and the automatic ones). */
import { coverKind } from "@app/ui";
import type { Shelf } from "../../services/libraryTypes.js";
import type { TextListItem } from "../../services/types.js";
import { readingNow, readingState } from "../../textPages.js";

export { readingState };

export type SortKey = "recent" | "title" | "coverage";

export const SORT_LABEL: Record<SortKey, string> = {
  recent: "Recently added",
  title: "Title",
  coverage: "Coverage",
};

const fold = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Texts whose title (edited or imported), author, note or level contain every query word. */
export function searchTexts(texts: readonly TextListItem[], query: string): TextListItem[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...texts];
  return texts.filter((t) => {
    const hay = fold(
      [t.title, t.importedTitle, t.author, t.note, t.level].filter(Boolean).join(" "),
    );
    return words.every((w) => hay.includes(w));
  });
}

const collator = new Intl.Collator("nl", { sensitivity: "base", numeric: true });

/** Sorted copy: newest first, by title (Dutch collation), or best coverage first (unanalysed last). */
export function sortTexts(texts: readonly TextListItem[], key: SortKey): TextListItem[] {
  const out = [...texts];
  if (key === "title") out.sort((a, b) => collator.compare(a.title, b.title));
  else if (key === "coverage") {
    out.sort((a, b) => (b.coverage ?? -1) - (a.coverage ?? -1) || b.createdAt - a.createdAt);
  } else out.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
  return out;
}

/** One row of the bookshelf. */
export interface ShelfRow {
  /** The learner's shelf id, or "auto:<name>". */
  id: string;
  name: string;
  texts: TextListItem[];
  /** A learner shelf (renamable, a drop target) rather than an automatic one. */
  own: boolean;
  /** Where the row sits: status rows or the learner's shelves. */
  group: "status" | "own";
}

/** The All texts view's Source filter: where texts came from. */
export const SOURCES = [
  { id: "all", name: "All sources", kinds: [] },
  { id: "course", name: "Course books", kinds: ["course"] },
  { id: "ai", name: "AI stories", kinds: ["ai"] },
  { id: "web", name: "Web", kinds: ["url"] },
  { id: "scans", name: "Photos & PDFs", kinds: ["image", "pdf"] },
  { id: "talk", name: "Talk", kinds: ["talk"] },
  { id: "pasted", name: "Pasted", kinds: ["paste"] },
] as const;
export type SourceId = (typeof SOURCES)[number]["id"];

/** Texts from one source ("all": every text), in the given order. */
export function bySource(texts: readonly TextListItem[], source: SourceId): TextListItem[] {
  if (source === "all") return [...texts];
  const kinds: readonly string[] = SOURCES.find((s) => s.id === source)?.kinds ?? [];
  return texts.filter((t) => kinds.includes(coverKind(t.sourceKind, t.sourceRef)));
}

/**
 * The bookshelf: Reading now (`readingNow`), the learner's shelves, To read and Finished. Where a
 * text came from is a filter on All texts, not more rows, so a text shows up at most twice. Rows keep `texts` in the given (already sorted) order; empty automatic rows are left
 * out, empty learner shelves stay (they are drop targets).
 */
export function shelfRows(
  texts: readonly TextListItem[],
  shelves: readonly Shelf[],
  lastId: string | null = null,
): ShelfRow[] {
  const by = (pred: (t: TextListItem) => boolean) => texts.filter(pred);
  const rows: ShelfRow[] = [];
  const auto = (id: string, name: string, list: TextListItem[], group: ShelfRow["group"]) => {
    if (list.length) rows.push({ id, name, texts: list, own: false, group });
  };
  // The same rule as Home's Continue reading: the text opened last leads.
  auto("auto:reading", "Reading now", readingNow(texts, lastId), "status");
  const byId = new Map(texts.map((t) => [t.id, t]));
  for (const s of shelves) {
    const on = new Set(s.textIds);
    rows.push({
      id: s.id,
      name: s.name,
      // In the page's sort order, not the order of adding.
      texts: texts.filter((t) => on.has(t.id) && byId.has(t.id)),
      own: true,
      group: "own",
    });
  }
  auto(
    "auto:new",
    "To read",
    by((t) => readingState(t).kind === "new"),
    "status",
  );
  auto(
    "auto:done",
    "Finished",
    by((t) => readingState(t).kind === "done"),
    "status",
  );
  return rows;
}

/** The course unit a text came from ("course:<id>:<unit>"), or null. */
export function courseUnitOf(
  sourceRef: string | null | undefined,
): { courseId: string; unit: string } | null {
  if (!sourceRef?.startsWith("course:")) return null;
  const rest = sourceRef.slice("course:".length);
  const at = rest.lastIndexOf(":");
  if (at <= 0 || at === rest.length - 1) return null;
  return { courseId: rest.slice(0, at), unit: rest.slice(at + 1) };
}
