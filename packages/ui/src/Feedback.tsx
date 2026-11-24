import type { CSSProperties, ReactNode } from "react";
import { cn } from "./cn.js";

/** Small rotating indicator; announces itself to assistive tech. */
export function Spinner({ label = "Loading" }: { label?: string }) {
  return <span className="k-spinner" role="status" aria-label={label} />;
}

/** Placeholder block shown while content loads. */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    // A span (styled as a block): it also stands in for text inside a paragraph.
    <span className={cn("k-skeleton", className)} style={{ height: 16, ...style }} aria-hidden />
  );
}

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

/** Calm empty-state block with an optional call to action. */
export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="k-empty">
      {icon ? <div className="k-empty-icon">{icon}</div> : null}
      <h2 className="k-empty-title">{title}</h2>
      {description ? <p style={{ margin: 0, maxWidth: "46ch" }}>{description}</p> : null}
      {action ? <div className="k-empty-actions">{action}</div> : null}
    </div>
  );
}
