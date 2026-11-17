import { ClipboardPaste, FileText, Globe, Image, ListChecks, Sparkles, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./Button.js";
import { Chip } from "./Chip.js";
import { BAND_LABEL, CoverageMeter, difficultyBand } from "./CoverageMeter.js";

export type TextSourceKind = "paste" | "url" | "pdf" | "image" | "ai";

export interface TextCardProps {
  title: string;
  sourceKind: TextSourceKind;
  wordCount: number;
  /** Coverage in [0, 1], null if the text is not analysed yet. */
  coverage: number | null;
  newTypes: number | null;
  onOpen?: () => void;
  /** Open the end-of-text word review. */
  onWords?: () => void;
  onDelete?: () => void;
}

const SOURCE_ICON: Record<TextSourceKind, ReactNode> = {
  paste: <ClipboardPaste size={16} aria-hidden />,
  url: <Globe size={16} aria-hidden />,
  pdf: <FileText size={16} aria-hidden />,
  image: <Image size={16} aria-hidden />,
  ai: <Sparkles size={16} aria-hidden />,
};

const SOURCE_LABEL: Record<TextSourceKind, string> = {
  paste: "Pasted text",
  url: "Web page",
  pdf: "PDF",
  image: "Photo",
  ai: "Written by AI for you",
};

/** Library card: title, source, size, coverage, new-word count and difficulty band. */
export function TextCard({
  title,
  sourceKind,
  wordCount,
  coverage,
  newTypes,
  onOpen,
  onWords,
  onDelete,
}: TextCardProps) {
  return (
    <article className="k-card">
      <div className="k-card-meta">
        <span title={SOURCE_LABEL[sourceKind]} role="img" aria-label={SOURCE_LABEL[sourceKind]}>
          {SOURCE_ICON[sourceKind]}
        </span>
        <span>{wordCount.toLocaleString("en")} words</span>
        {sourceKind === "ai" ? <Chip tone="accent">AI story</Chip> : null}
        {onWords ? (
          <Button
            variant="ghost"
            size="sm"
            icon
            aria-label={`Words from ${title}`}
            title="Words from this text"
            style={{ marginLeft: "auto" }}
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
            style={onWords ? {} : { marginLeft: "auto" }}
            onClick={onDelete}
          >
            <Trash2 size={16} />
          </Button>
        ) : null}
      </div>
      <button type="button" className="k-card-title" onClick={() => onOpen?.()}>
        {title}
      </button>
      <CoverageMeter value={coverage} block />
      <div className="k-card-meta">
        {coverage !== null ? (
          <Chip tone={difficultyBand(coverage) === "comfortable" ? "success" : "warm"}>
            {BAND_LABEL[difficultyBand(coverage)]}
          </Chip>
        ) : null}
        {newTypes !== null ? (
          <span title="Words in the whole text that you do not know yet">{newTypes} unknown</span>
        ) : null}
      </div>
    </article>
  );
}
