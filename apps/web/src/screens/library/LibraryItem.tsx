import { Link } from "@tanstack/react-router";
import { CoverageMeter, TextCover, WordStateChip, coverKind } from "@app/ui";
import { Check } from "lucide-react";
import type { DragEvent, FocusEvent, KeyboardEvent } from "react";
import type { TextListItem } from "../../services/types.js";
import { type MenuItem, MenuButton } from "./MenuButton.js";
import { coverLine } from "./coverLine.js";
import { readingState } from "./shelving.js";
import { useCoverUrl } from "./useCoverUrl.js";
import { useCanAddTexts } from "../../platform/canAddTexts.js";

/** MIME type of a dragged Library cover (JSON array of text ids). */
export const DRAG_TYPE = "application/x-vuurtoren-texts";
/** The shelf a dragged cover comes from: a drop on another shelf moves it (Ctrl keeps both). */
export const FROM_SHELF_TYPE = "application/x-vuurtoren-from-shelf";

export interface LibraryItemProps {
  text: TextListItem;
  /** "shelf": a cover in a bookshelf row; "grid": the All texts view, with more meta. */
  variant: "shelf" | "grid";
  menu: MenuItem[];
  /** Select mode: the cover toggles this text's selection instead of opening it. */
  onToggle: () => void;
  selecting: boolean;
  selected: boolean;
  /** Roving focus inside a shelf row: only the active cover is in the tab order. */
  tabIndex?: number;
  onFocus?: (e: FocusEvent<HTMLElement>) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
  /** Ids to drag with this cover (the selection when it is part of it). */
  dragIds: () => string[];
  /** The learner's shelf this cover sits on, if any (dragging it away moves it). */
  fromShelf?: string | undefined;
}

/** One text on the Library shelf: the cover, a quiet line under it and a "…" menu. */
export function LibraryItem({
  text: t,
  variant,
  menu,
  onToggle,
  selecting,
  selected,
  tabIndex,
  onFocus,
  onKeyDown,
  dragIds,
  fromShelf,
}: LibraryItemProps) {
  const imageUrl = useCoverUrl(t.coverId);
  const state = readingState(t);
  const canAdd = useCanAddTexts();
  // A phone without a server can't prepare a text: it waits for the computer to send it (SY4).
  const waiting = !t.analyzed && !canAdd;
  const status = waiting
    ? "Waiting for your computer"
    : state.kind === "reading"
      ? `Page ${state.page} of ${state.pages}`
      : state.kind === "done"
        ? "Finished"
        : `${t.wordCount.toLocaleString("en")} words`;
  const onDragStart = (e: DragEvent<HTMLElement>) => {
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(dragIds()));
    if (fromShelf) e.dataTransfer.setData(FROM_SHELF_TYPE, fromShelf);
    e.dataTransfer.setData("text/plain", t.title);
    e.dataTransfer.effectAllowed = "copyMove";
  };
  const cover = (
    <TextCover
      title={t.title}
      kind={coverKind(t.sourceKind, t.sourceRef)}
      coverage={t.coverage}
      showLabel={variant === "grid"}
      imageUrl={imageUrl}
    />
  );
  return (
    <li className="lib-item" data-variant={variant} data-selected={selected ? "" : undefined}>
      <div className="lib-item-cover">
        {selecting ? (
          <button
            type="button"
            className="lib-open"
            data-text-id={t.id}
            aria-label={t.title}
            aria-pressed={selected}
            {...(tabIndex !== undefined ? { tabIndex } : {})}
            draggable={selected}
            onDragStart={onDragStart}
            onClick={onToggle}
            onFocus={onFocus}
            onKeyDown={onKeyDown}
          >
            {cover}
            <span className="lib-check" aria-hidden>
              {selected ? <Check size={14} /> : null}
            </span>
          </button>
        ) : (
          // A real link: middle-click and "Open in new tab" work.
          <Link
            to="/read/$textId"
            params={{ textId: t.id }}
            className="lib-open"
            data-text-id={t.id}
            aria-label={t.title}
            {...(tabIndex !== undefined ? { tabIndex } : {})}
            draggable
            onDragStart={onDragStart}
            onFocus={onFocus}
            onKeyDown={onKeyDown}
          >
            {cover}
          </Link>
        )}
        {selecting ? null : (
          <MenuButton className="lib-item-menu" label={`More for ${t.title}`} items={menu} />
        )}
      </div>
      <div className="lib-item-meta">
        <span>{status}</span>
        {variant === "shelf" && coverLine(t.level ?? t.roughLevel, t.newTypes) ? (
          <span>{coverLine(t.level ?? t.roughLevel, t.newTypes)}</span>
        ) : null}
        {t.level && variant === "grid" ? <span className="lib-level">{t.level}</span> : null}
        {/* Your own texts: a rough level from the common words (stories have their own). */}
        {variant === "grid" && !t.level && t.roughLevel ? (
          <span className="lib-level" title="How common its words are">
            about {t.roughLevel}
          </span>
        ) : null}
        {variant === "grid" && t.newTypes !== null ? (
          <WordStateChip state="unknown" count={t.newTypes} />
        ) : null}
      </div>
      {variant === "grid" ? (
        <>
          {t.author || t.note ? (
            <p className="lib-item-note">{[t.author, t.note].filter(Boolean).join(" · ")}</p>
          ) : null}
          <CoverageMeter value={t.coverage} block label="Whole text" />
        </>
      ) : null}
    </li>
  );
}
