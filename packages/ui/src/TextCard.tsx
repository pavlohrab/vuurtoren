import { ArrowRight, ListChecks, Trash2 } from "lucide-react";
import { Button } from "./Button.js";
import { Chip } from "./Chip.js";
import { BAND_LABEL, CoverageMeter, difficultyBand } from "./CoverageMeter.js";
import { TextCover, coverKind } from "./TextCover.js";
import { WordStateChip } from "./WordState.js";

export type TextSourceKind = "paste" | "url" | "pdf" | "image" | "ai" | "talk";

export interface TextCardProps {
  title: string;
  sourceKind: TextSourceKind;
  /** URL, file name, "course:…" or "talk:…": picks the cover of course texts and saved talks. */
  sourceRef?: string | undefined;
  wordCount: number;
  /** Coverage in [0, 1], null if the text is not analysed yet. */
  coverage: number | null;
  newTypes: number | null;
  /** Reading progress of a text in progress (page to continue on); null when not started. */
  progress?: { page: number; pages: number } | null;
  onOpen?: () => void;
  /** Open the end-of-text word review. */
  onWords?: () => void;
  onDelete?: () => void;
}

/**
 * Library shelf card: a cover per source kind, the title, coverage of the whole text, new words
 * and difficulty band, and Continue for texts in progress.
 */
export function TextCard({
  title,
  sourceKind,
  sourceRef,
  wordCount,
  coverage,
  newTypes,
  progress = null,
  onOpen,
  onWords,
  onDelete,
}: TextCardProps) {
  const kind = coverKind(sourceKind, sourceRef);
  const band = coverage !== null ? difficultyBand(coverage) : null;
  return (
    <article className="k-shelf-card">
      <button type="button" className="k-shelf-open" onClick={() => onOpen?.()} aria-label={title}>
        <TextCover title={title} kind={kind} coverage={coverage} />
      </button>
      <div className="k-card-meta">
        <span>{wordCount.toLocaleString("en")} words</span>
        {newTypes !== null ? <WordStateChip state="unknown" count={newTypes} /> : null}
        {/* No band chip below "challenging": there is no weave mode to suggest yet. */}
        {band && band !== "weave" && band !== "comfortable" ? (
          <Chip tone="warm">{BAND_LABEL[band]}</Chip>
        ) : null}
      </div>
      <CoverageMeter value={coverage} block label="Whole text" />
      <div className="k-shelf-foot">
        <button type="button" className="k-link" onClick={onOpen}>
          {progress ? `Continue · page ${progress.page} of ${progress.pages}` : "Start reading"}
          <ArrowRight size={14} aria-hidden />
        </button>
        <span className="k-shelf-tools">
          {onWords ? (
            <Button
              variant="ghost"
              size="sm"
              icon
              aria-label={`Words from ${title}`}
              title="Words from this text"
              onClick={onWords}
            >
              <ListChecks size={16} />
            </Button>
          ) : null}
          {onDelete ? (
            <Button
              variant="ghost"
              size="sm"
              icon
              className="k-card-delete"
              aria-label={`Delete ${title}`}
              title="Delete"
              onClick={onDelete}
            >
              <Trash2 size={16} />
            </Button>
          ) : null}
        </span>
      </div>
    </article>
  );
}
