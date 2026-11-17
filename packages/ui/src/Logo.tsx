import type * as React from "react";
import { cn } from "./cn.js";

/**
 * The Kenning mark: a "k" inside a coverage ring that is three-quarters complete, the share of
 * a text you already know. The ring starts at 12 o'clock and runs counter-clockwise, so the
 * open quarter sits at the top right, where the k's arm points.
 *
 * Geometry is drawn on three grids (docs/design/design-system.md, Logo): a 48 px master for
 * large sizes, a heavier 24 px cut for 19–32 px and a 16 px cut for favicons. Stroke weights follow Instrument
 * Sans SemiBold; all caps and joins are round. The ring is the accent, the k is ink.
 */
interface MarkGeometry {
  vb: number;
  r: number;
  ring: number;
  k: number;
  d: string;
}

const GRID_48: MarkGeometry = {
  vb: 48,
  r: 18.5,
  ring: 4.5,
  k: 4.5,
  d: "M19 13V35M19 29.5L29 19.5M23 25.5L29.75 35",
};
/** 16 px cut: a full-bleed 2 px ring and a 2 px k, for favicons and the tiniest uses. */
const GRID_16: MarkGeometry = {
  vb: 16,
  r: 7,
  ring: 2,
  k: 2,
  d: "M6 4V12M6 10.5L10.25 6.25M8 8.5L10.5 12",
};
const GRID_24: MarkGeometry = {
  vb: 24,
  r: 9.5,
  ring: 2.75,
  k: 2.5,
  d: "M9.5 6V18M9.5 15L15 9.5M11.75 12.75L15.25 18",
};

/** The default ring value of the mark. */
export const LOGO_COVERAGE = 0.75;

export interface LogoMarkProps {
  /** Rendered size in px. */
  size?: number;
  /**
   * Coverage in [0, 1]. When set, the ring fills to this value once on mount (an animation that
   * is off under reduced motion); otherwise the ring is the static 3/4 brand arc.
   */
  coverage?: number | undefined;
  /** Accessible name; omit for a decorative mark. */
  title?: string;
  className?: string;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

/** The ring arc for a fraction, counter-clockwise from 12 o'clock. */
export function ringArc(c: number, r: number, frac: number): string {
  const f = clamp01(frac);
  if (f >= 0.9999) {
    return `M${c} ${c - r}A${r} ${r} 0 1 0 ${c} ${c + r}A${r} ${r} 0 1 0 ${c} ${c - r}`;
  }
  const a = f * 2 * Math.PI;
  const x = +(c - r * Math.sin(a)).toFixed(3);
  const y = +(c - r * Math.cos(a)).toFixed(3);
  return `M${c} ${c - r}A${r} ${r} 0 ${f > 0.5 ? 1 : 0} 0 ${x} ${y}`;
}

/** The coverage-ring mark on its own. */
export function LogoMark({ size = 24, coverage, title, className }: LogoMarkProps) {
  const g = size <= 18 ? GRID_16 : size <= 32 ? GRID_24 : GRID_48;
  const c = g.vb / 2;
  const animated = coverage !== undefined;
  const value = animated ? clamp01(coverage) : LOGO_COVERAGE;
  return (
    <svg
      className={cn("k-logo-mark", animated && "k-logo-mark--live", className)}
      width={size}
      height={size}
      viewBox={`0 0 ${g.vb} ${g.vb}`}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      data-coverage={Math.round(value * 1000) / 1000}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {animated ? (
        <circle className="k-logo-track" cx={c} cy={c} r={g.r} fill="none" strokeWidth={g.ring} />
      ) : null}
      {value > 0 ? (
        <path
          className="k-logo-ring"
          d={ringArc(c, g.r, value)}
          fill="none"
          strokeWidth={g.ring}
          strokeLinecap="round"
          pathLength={animated ? 1 : undefined}
        />
      ) : null}
      <path
        className="k-logo-k"
        d={g.d}
        fill="none"
        strokeWidth={g.k}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export interface LogoProps extends LogoMarkProps {
  /** "full" = mark + wordmark (default); "mark" = the mark alone. */
  variant?: "full" | "mark";
}

/** The Kenning logo: the coverage-ring mark with the "kenning" wordmark in Instrument Sans. */
export function Logo({ variant = "full", size = 24, className, title, ...rest }: LogoProps) {
  if (variant === "mark") {
    return (
      <LogoMark
        size={size}
        title={title ?? "Kenning"}
        {...(className ? { className } : {})}
        {...rest}
      />
    );
  }
  return (
    <span
      className={cn("k-logo", className)}
      style={{ ["--k-logo-size" as string]: `${size}px` }}
      role="img"
      aria-label={title ?? "Kenning"}
    >
      <LogoMark size={size} {...rest} />
      <span className="k-logo-word" aria-hidden>
        kenning
      </span>
    </span>
  );
}

export interface ProgressRingProps {
  /** Fraction in [0, 1]. */
  value: number;
  /** Size in px. */
  size?: number;
  /** Stroke width in px. */
  stroke?: number;
  /** Accessible label, e.g. "Known words". */
  label: string;
  /** Centre content (a number, a short label). */
  children?: React.ReactNode;
  /** Ring colour: known (default) or accent. */
  tone?: "known" | "accent";
  className?: string;
}

/**
 * A ring in the logo's language (12 o'clock, counter-clockwise, round caps) that fills to its
 * value once on mount.
 */
export function ProgressRing({
  value,
  size = 120,
  stroke = 8,
  label,
  children,
  tone = "known",
  className,
}: ProgressRingProps) {
  const v = clamp01(value);
  const c = size / 2;
  const r = c - stroke / 2 - 1;
  return (
    <div
      className={cn("k-ring", `k-ring--${tone}`, className)}
      style={{ width: size, height: size }}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 1000) / 10}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden focusable="false">
        <circle className="k-ring-track" cx={c} cy={c} r={r} fill="none" strokeWidth={stroke} />
        {v > 0 ? (
          <path
            className="k-ring-value"
            d={ringArc(c, r, v)}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            pathLength={1}
          />
        ) : null}
      </svg>
      {children ? <div className="k-ring-centre">{children}</div> : null}
    </div>
  );
}
