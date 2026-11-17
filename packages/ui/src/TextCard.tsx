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
    <article className="k-card k-shelf-card">
      <TextCover title={title} kind={kind} coverage={coverage} />
      <button type="button" className="k-card-title k-shelf-title" onClick={() => onOpen?.()}>
        {title}
      </button>
      <div className="k-card-meta">
        <span>{wordCount.toLocaleString("en")} words</span>
        {/* No band chip below "challenging": there is no weave mode to suggest yet. */}
        {band && band !== "weave" ? (
          <Chip tone={band === "comfortable" ? "success" : "warm"}>{BAND_LABEL[band]}</Chip>
        ) : null}
        {newTypes !== null ? <WordStateChip state="unknown" count={newTypes} /> : null}
      </div>
      <CoverageMeter value={coverage} block label="Whole text" />
      <div className="k-shelf-foot">
        {progress ? (
          <Button size="sm" variant="primary" className="k-shelf-continue" onClick={onOpen}>
            Continue · page {progress.page} of {progress.pages}
            <ArrowRight size={14} aria-hidden />
          </Button>
        ) : (
          <Button size="sm" variant="secondary" className="k-shelf-continue" onClick={onOpen}>
            Start reading
          </Button>
        )}
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
