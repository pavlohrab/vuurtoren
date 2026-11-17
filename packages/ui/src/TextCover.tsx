import {
  ClipboardPaste,
  FileText,
  Globe,
  GraduationCap,
  Image,
  MessagesSquare,
  Sparkles,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "./cn.js";

/** Where a text came from, as its Library cover shows it. */
export type CoverKind = "paste" | "url" | "pdf" | "image" | "ai" | "course" | "talk";

/** The cover kind of a text: course texts are pasted with a "course:" reference. */
export function coverKind(sourceKind: string, sourceRef?: string | null): CoverKind {
  if (sourceRef?.startsWith("course:")) return "course";
  if (sourceRef?.startsWith("talk:")) return "talk";
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
};

const COVER_ICON: Record<CoverKind, (size: number) => ReactNode> = {
  paste: (s) => <ClipboardPaste size={s} aria-hidden />,
  url: (s) => <Globe size={s} aria-hidden />,
  pdf: (s) => <FileText size={s} aria-hidden />,
  image: (s) => <Image size={s} aria-hidden />,
  ai: (s) => <Sparkles size={s} aria-hidden />,
  course: (s) => <GraduationCap size={s} aria-hidden />,
  talk: (s) => <MessagesSquare size={s} aria-hidden />,
};

/** A small stable hash of the title, so each cover's pattern sits a little differently. */
function seed(title: string): number {
  let h = 2166136261;
  for (let i = 0; i < title.length; i++) h = Math.imul(h ^ title.charCodeAt(i), 16777619);
  return h >>> 0;
}

export interface TextCoverProps {
  title: string;
  kind: CoverKind;
  /** Coverage in [0, 1]: a thin known-colour line along the bottom edge. */
  coverage?: number | null;
  size?: "sm" | "md";
  /** Show the kind label next to the icon (md covers). */
  showLabel?: boolean;
  className?: string;
  children?: ReactNode;
}

/**
 * The decorative cover of a text: a quiet generated pattern per source kind (stripes, dots,
 * grid…) offset by the title, with the source icon. Purely visual (aria-hidden pattern).
 */
export function TextCover({
  title,
  kind,
  coverage = null,
  size = "md",
  showLabel = size === "md",
  className,
  children,
}: TextCoverProps) {
  const h = seed(title);
  const style = {
    "--cover-angle": `${(h % 8) * 22.5 + 15}deg`,
    "--cover-shift": `${h % 23}px`,
  } as CSSProperties;
  return (
    <div className={cn("k-cover", `k-cover--${size}`, className)} data-kind={kind} style={style}>
      <span className="k-cover-pattern" aria-hidden />
      <span className="k-cover-kind" title={COVER_LABEL[kind]}>
        {COVER_ICON[kind](size === "sm" ? 14 : 16)}
        {showLabel ? (
          <span>{COVER_LABEL[kind]}</span>
        ) : (
          <span className="k-sr">{COVER_LABEL[kind]}</span>
        )}
      </span>
      {children}
      {coverage !== null ? (
        <span className="k-cover-meter" aria-hidden>
          <span style={{ transform: `scaleX(${Math.max(0, Math.min(1, coverage))})` }} />
        </span>
      ) : null}
    </div>
  );
}
