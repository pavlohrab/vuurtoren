import { cn } from "./cn.js";

export type DifficultyBand = "comfortable" | "stretch" | "challenging" | "weave";

/** Map a coverage fraction (0..1) to its difficulty band. */
export function difficultyBand(coverage: number): DifficultyBand {
  if (coverage >= 0.98) return "comfortable";
  if (coverage >= 0.95) return "stretch";
  if (coverage >= 0.9) return "challenging";
  return "weave";
}

export const BAND_LABEL: Record<DifficultyBand, string> = {
  comfortable: "Comfortable",
  stretch: "Stretch",
  challenging: "Challenging",
  weave: "Very challenging",
};

export interface CoverageMeterProps {
  /** Coverage in [0, 1]; null when not yet known. */
  value: number | null;
  /** Stretch the bar to the container width. */
  block?: boolean;
  /** Hide the numeric label. */
  hideValue?: boolean;
  /** What the number covers, shown before the bar, e.g. "This page" or "Whole text". */
  label?: string;
  className?: string;
}

/**
 * Thin progress bar plus percentage showing how much of a text the learner knows.
 * The fill is always the accent (teal = known); the band is only exposed as `data-band`.
 */
export function CoverageMeter({ value, block, hideValue, label, className }: CoverageMeterProps) {
  const labelEl = label ? <span className="k-meter-label">{label}</span> : null;
  if (value === null) {
    return (
      <span className={cn("k-meter", block && "k-meter--block", className)}>
        {labelEl}
        <span className="k-meter-value" style={{ color: "var(--ink-muted)" }}>
          Not analysed
        </span>
      </span>
    );
  }
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <span
      className={cn("k-meter", block && "k-meter--block", className)}
      data-band={difficultyBand(value)}
      role="meter"
      aria-label={label ? `Coverage, ${label.toLowerCase()}` : "Coverage"}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct * 10) / 10}
    >
      {labelEl}
      <span className="k-meter-track">
        <span className="k-meter-fill" style={{ width: `${pct}%` }} />
      </span>
      {hideValue ? null : <span className="k-meter-value">{pct.toFixed(1)}%</span>}
    </span>
  );
}
