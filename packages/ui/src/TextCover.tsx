import {
  BookOpen,
  ClipboardPaste,
  FileText,
  Globe,
  GraduationCap,
  Image,
  MessagesSquare,
  Sparkles,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn.js";

/** Where a text came from, as its Library cover shows it. */
export type CoverKind = "paste" | "url" | "pdf" | "image" | "ai" | "course" | "talk" | "story";

/** The cover kind of a text: course texts are pasted with a "course:" reference. */
export function coverKind(sourceKind: string, sourceRef?: string | null): CoverKind {
  if (sourceRef?.startsWith("course:")) return "course";
  if (sourceRef?.startsWith("talk:")) return "talk";
  // One of the stories that come with Vuurtoren: not something the learner pasted.
  if (sourceRef?.startsWith("story:")) return "story";
  switch (sourceKind) {
    case "url":
    case "pdf":
    case "image":
    case "ai":
    case "talk":
      return sourceKind;
    default:
      return "paste";
  }
}

export const COVER_LABEL: Record<CoverKind, string> = {
  paste: "Pasted text",
  url: "Web page",
  pdf: "PDF",
  image: "Photo",
  ai: "AI story",
  course: "Course text",
  talk: "Conversation",
  story: "Story",
};

const COVER_ICON: Record<CoverKind, (size: number) => ReactNode> = {
  paste: (s) => <ClipboardPaste size={s} aria-hidden />,
  url: (s) => <Globe size={s} aria-hidden />,
  pdf: (s) => <FileText size={s} aria-hidden />,
  image: (s) => <Image size={s} aria-hidden />,
  ai: (s) => <Sparkles size={s} aria-hidden />,
  course: (s) => <GraduationCap size={s} aria-hidden />,
  talk: (s) => <MessagesSquare size={s} aria-hidden />,
  story: (s) => <BookOpen size={s} aria-hidden />,
};

export interface TextCoverProps {
  title: string;
  kind: CoverKind;
  /** Coverage in [0, 1]: a thin known-colour line along the bottom edge. */
  coverage?: number | null;
  /** Also print the coverage percentage at the top right (when no meter sits next to the cover). */
  showPercent?: boolean;
  size?: "sm" | "md";
  /** Show the kind label next to the icon. */
  showLabel?: boolean;
  className?: string;
  /**
   * A cover image (first page of a PDF, a photo, the learner's own): it fills the cover and the
   * title sits on a quiet band at the bottom. Without one the cover is typographic.
   */
  imageUrl?: string | null;
  /** Replaces the printed title (e.g. a button carrying the title, so it is not read twice). */
  titleSlot?: ReactNode;
  children?: ReactNode;
}

/**
 * The cover of a text, typographic (docs/dev/design-system.md, Covers): a flat tint per source kind with
 * a spine, the source icon and kind at the top, the title in Literata at the bottom and the
 * coverage as a thin known-colour line on the bottom edge. With `imageUrl` the image fills it.
 */
export function TextCover({
  title,
  kind,
  coverage = null,
  showPercent = false,
  size = "md",
  showLabel = true,
  className,
  imageUrl = null,
  titleSlot,
  children,
}: TextCoverProps) {
  const cov = coverage === null ? null : Math.max(0, Math.min(1, coverage));
  return (
    <div
      className={cn("k-cover", `k-cover--${size}`, className)}
      data-kind={kind}
      {...(imageUrl ? { "data-image": "" } : {})}
    >
      {imageUrl ? <img className="k-cover-img" src={imageUrl} alt="" draggable={false} /> : null}
      <span className="k-cover-top">
        <span className="k-cover-kind" title={COVER_LABEL[kind]}>
          {COVER_ICON[kind](size === "sm" ? 13 : 14)}
          {showLabel ? (
            <span>{COVER_LABEL[kind]}</span>
          ) : (
            <span className="k-sr">{COVER_LABEL[kind]}</span>
          )}
        </span>
        {showPercent && cov !== null ? (
          <span className="k-cover-pct" aria-hidden>
            {Math.round(cov * 100)}%
          </span>
        ) : null}
      </span>
      {titleSlot ?? (
        <span className="k-cover-title" lang="nl">
          {title}
        </span>
      )}
      <span className="k-cover-rule" aria-hidden />
      {children}
      {cov !== null ? (
        <span className="k-cover-meter" aria-hidden>
          <span style={{ transform: `scaleX(${cov})` }} />
        </span>
      ) : null}
    </div>
  );
}
