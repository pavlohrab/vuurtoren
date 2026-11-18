import type * as React from "react";
import { cn } from "./cn.js";

/**
 * The Kenning mark: a lowercase k whose leg is a bookmark ribbon. Stem and arm are ink; the leg
 * is a honey-accent ribbon tucked under the arm (a hairline gap) that hangs just below the
 * baseline and ends in a level swallow-tail notch, the bookmark you leave in a text.
 *
 * Geometry is drawn on three grids (docs/design/design-system.md, Logo): a 48 px master for
 * large sizes, a 24 px cut for 19–32 px and a simplified 16 px cut for favicons (pixel-aligned
 * stem and arm, steeper ribbon so the notch survives). Stroke weights follow Instrument Sans
 * SemiBold; terminals are flat. Every number is listed in the design doc; change both together.
 */
interface MarkGeometry {
  vb: number;
  /** Stem + arm (ink). */
  ink: string;
  /** The bookmark ribbon (accent). */
  ribbon: string;
}

export const LOGO_GRID_48: MarkGeometry = {
  vb: 48,
  ink: "M12 5H18V40H12ZM12.5 40V33.01L27.51 18H36L14 40Z",
  ribbon: "M27.09 29.03L35.44 43.5L31.4 40L27.36 43.5L21.96 34.16Z",
};
const LOGO_GRID_24: MarkGeometry = {
  vb: 24,
  ink: "M6 2.5H9V20H6ZM6.5 20V16.5L14 9H18L7 20Z",
  ribbon: "M13.51 14.55L17.81 22L15.79 20L13.77 22L10.95 17.11Z",
};
const LOGO_GRID_16: MarkGeometry = {
  vb: 16,
  ink: "M3 1H5V13H3ZM3.5 13V10.5L9 5H12L4 13Z",
  ribbon: "M10.74 7.67L13.18 15L11.5 13L9.81 15L8.21 10.2Z",
};

/** The grid cut used at a rendered size. */
export function logoGrid(size: number): MarkGeometry {
  return size <= 18 ? LOGO_GRID_16 : size <= 32 ? LOGO_GRID_24 : LOGO_GRID_48;
}

export interface LogoMarkProps {
  /** Rendered size in px. */
  size?: number;
  /** Accessible name; omit for a decorative mark. */
  title?: string;
  className?: string;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

/** A ring arc for a fraction, counter-clockwise from 12 o'clock (used by ProgressRing). */
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

/** The bookmark-k mark on its own. */
export function LogoMark({ size = 24, title, className }: LogoMarkProps) {
  const g = logoGrid(size);
  return (
    <svg
      className={cn("k-logo-mark", className)}
      width={size}
      height={size}
      viewBox={`0 0 ${g.vb} ${g.vb}`}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <path className="k-logo-ribbon" d={g.ribbon} />
      <path className="k-logo-k" d={g.ink} />
    </svg>
  );
}

export interface LogoProps extends LogoMarkProps {
  /** "full" = mark + wordmark (default); "mark" = the mark alone. */
  variant?: "full" | "mark";
}

/** The Kenning logo: the bookmark-k mark with the "kenning" wordmark in Instrument Sans. */
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
 * A data ring (12 o'clock, counter-clockwise, round caps) that fills to its value once on mount.
 * Kept separate from the mark: the logo is a bookmark, the ring is for numbers.
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
