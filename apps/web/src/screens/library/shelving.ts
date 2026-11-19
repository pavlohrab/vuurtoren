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
  /** Where the row sits: status rows, the learner's shelves, rows by source. */
  group: "status" | "own" | "source";
}

const SOURCE_SHELVES: { id: string; name: string; kinds: string[] }[] = [
  { id: "auto:course", name: "Course books", kinds: ["course"] },
  { id: "auto:ai", name: "AI stories", kinds: ["ai"] },
  { id: "auto:web", name: "Web", kinds: ["url"] },
  { id: "auto:scans", name: "Photos & PDFs", kinds: ["image", "pdf"] },
  { id: "auto:talk", name: "Talk", kinds: ["talk"] },
];

/**
 * The bookshelf: Reading now (`readingNow`), the learner's shelves, To read and Finished, then one row per
 * source. Rows keep `texts` in the given (already sorted) order; empty automatic rows are left
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
  for (const s of SOURCE_SHELVES) {
    auto(
      s.id,
      s.name,
      by((t) => s.kinds.includes(coverKind(t.sourceKind, t.sourceRef))),
      "source",
    );
  }
  return rows;
}
