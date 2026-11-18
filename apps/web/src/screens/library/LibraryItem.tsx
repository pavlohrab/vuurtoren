import { CoverageMeter, TextCover, WordStateChip, coverKind } from "@app/ui";
import { Check } from "lucide-react";
import type { DragEvent, FocusEvent, KeyboardEvent } from "react";
import type { TextListItem } from "../../services/types.js";
import { type MenuItem, MenuButton } from "./MenuButton.js";
import { readingState } from "./shelving.js";
import { useCoverUrl } from "./useCoverUrl.js";

/** MIME type of a dragged Library cover (JSON array of text ids). */
export const DRAG_TYPE = "application/x-kenning-texts";

export interface LibraryItemProps {
  text: TextListItem;
  /** "shelf": a cover in a bookshelf row; "grid": the All texts view, with more meta. */
  variant: "shelf" | "grid";
  menu: MenuItem[];
  onOpen: () => void;
  selecting: boolean;
  selected: boolean;
  /** Roving focus inside a shelf row: only the active cover is in the tab order. */
  tabIndex?: number;
  onFocus?: (e: FocusEvent<HTMLButtonElement>) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLButtonElement>) => void;
  /** Ids to drag with this cover (the selection when it is part of it). */
  dragIds: () => string[];
}

/** One text on the Library shelf: the cover, a quiet line under it and a "…" menu. */
export function LibraryItem({
  text: t,
  variant,
  menu,
  onOpen,
  selecting,
  selected,
  tabIndex,
  onFocus,
  onKeyDown,
  dragIds,
}: LibraryItemProps) {
  const imageUrl = useCoverUrl(t.coverId);
  const state = readingState(t);
  const status =
    state.kind === "reading"
      ? `Page ${state.page} of ${state.pages}`
      : state.kind === "done"
        ? "Finished"
        : `${t.wordCount.toLocaleString("en")} words`;
  const onDragStart = (e: DragEvent<HTMLButtonElement>) => {
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(dragIds()));
    e.dataTransfer.setData("text/plain", t.title);
    e.dataTransfer.effectAllowed = "copy";
  };
  return (
    <li className="lib-item" data-variant={variant} data-selected={selected ? "" : undefined}>
      <div className="lib-item-cover">
        <button
          type="button"
          className="lib-open"
          data-text-id={t.id}
          aria-label={t.title}
          {...(selecting ? { "aria-pressed": selected } : {})}
          {...(tabIndex !== undefined ? { tabIndex } : {})}
          draggable={!selecting || selected}
          onDragStart={onDragStart}
          onClick={onOpen}
          onFocus={onFocus}
          onKeyDown={onKeyDown}
        >
          <TextCover
            title={t.title}
            kind={coverKind(t.sourceKind, t.sourceRef)}
            coverage={t.coverage}
            showLabel={variant === "grid"}
            imageUrl={imageUrl}
          />
          {selecting ? (
            <span className="lib-check" aria-hidden>
              {selected ? <Check size={14} /> : null}
            </span>
          ) : null}
        </button>
        {selecting ? null : (
          <MenuButton className="lib-item-menu" label={`More for ${t.title}`} items={menu} />
        )}
      </div>
      <div className="lib-item-meta">
        <span>{status}</span>
        {variant === "shelf" && t.coverage !== null ? (
          <span className="lib-known">{Math.round(t.coverage * 100)}% known</span>
        ) : null}
        {t.level && variant === "grid" ? <span className="lib-level">{t.level}</span> : null}
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
