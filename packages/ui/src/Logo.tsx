import type * as React from "react";
import { cn } from "./cn.js";

/**
 * The Vuurtoren mark ("B1"): a lighthouse whose beam is an amber highlight bar, beside three lines
 * of text where one word is lit the same way (the reader highlights the few words worth learning).
 * Lamp housing, tower, base and text lines are ink (`currentColor`); lamp, beam and the lit word
 * are `--accent`. Drawn on a 64 grid; the same shapes are in `apps/web/public/logo-mark.svg`,
 * `favicon.svg`, the app icons and the README lockups (docs/design-system.md, Logo).
 */
type Shape = { ink?: true; x: number; y: number; w: number; h: number; rx: number; faint?: true };
const MARK_RECTS: readonly Shape[] = [
  { ink: true, x: 10, y: 8, w: 12, h: 13, rx: 2.5 },
  { x: 13, y: 11, w: 6, h: 7, rx: 1.2 },
  { x: 25, y: 11.5, w: 35, h: 6, rx: 3 },
  { ink: true, x: 3, y: 57, w: 26, h: 3.5, rx: 1.2 },
  { ink: true, x: 32, y: 28, w: 28, h: 3.5, rx: 1.75, faint: true },
  { ink: true, x: 32, y: 37, w: 10, h: 3.5, rx: 1.75, faint: true },
  { x: 44.5, y: 36, w: 15.5, h: 5.5, rx: 2.75 },
  { ink: true, x: 32, y: 46, w: 23, h: 3.5, rx: 1.75, faint: true },
];
/** The tower (a tapered trapezoid standing on the base). */
const MARK_TOWER = "M9 24h14l3.5 33h-21z";

/**
 * "vuurtoren" in Literata Medium (opsz 36), outlined so it renders without the web font. Same
 * vertical units as the mark (64 high, baseline at 60.5, x-height 22) so the two line up.
 */
const WORD_PATH =
  "M10.16 60.5 3.32 42.93Q3.01 42.12 2.8 41.69Q2.58 41.26 2.28 41.02Q1.98 40.78 1.38 40.65L0 40.31L0.3 38.5H11.32V40.27L9.39 40.52Q8.57 40.61 8.37 41.08Q8.18 41.56 8.61 42.68L13.56 56.37H13.78L18.56 42.93Q18.94 41.94 18.77 41.36Q18.6 40.78 17.57 40.57L15.84 40.22L16.19 38.5H24.63V40.27L23.12 40.57Q22.34 40.74 21.98 41.15Q21.61 41.56 21.1 42.89L14.55 60.5ZM35.99 61.1Q32.63 61.1 30.87 59.21Q29.1 57.31 29.1 53.7V43.36Q29.1 41.86 28.85 41.36Q28.59 40.87 27.64 40.74L25.96 40.48L26.18 38.72L33.54 38.24L34.01 38.54V52.84Q34.01 54.77 34.38 55.94Q34.74 57.1 35.56 57.62Q36.38 58.13 37.8 58.13Q39.39 58.13 40.56 57.44Q41.72 56.75 42.34 55.48Q42.97 54.21 42.97 52.49V43.36Q42.97 41.86 42.73 41.36Q42.49 40.87 41.55 40.74L39.87 40.48L40.13 38.72L47.44 38.24L47.87 38.54V56.41Q47.87 57.49 48.18 57.9Q48.48 58.3 49.3 58.43L51.28 58.73V60.5L43.83 60.8L43.27 57.14H43.14Q42.19 58.48 41.14 59.36Q40.08 60.24 38.83 60.67Q37.59 61.1 35.99 61.1ZM63.37 61.1Q60.02 61.1 58.25 59.21Q56.49 57.31 56.49 53.7V43.36Q56.49 41.86 56.23 41.36Q55.97 40.87 55.02 40.74L53.34 40.48L53.56 38.72L60.92 38.24L61.39 38.54V52.84Q61.39 54.77 61.76 55.94Q62.13 57.1 62.94 57.62Q63.76 58.13 65.18 58.13Q66.77 58.13 67.94 57.44Q69.1 56.75 69.72 55.48Q70.35 54.21 70.35 52.49V43.36Q70.35 41.86 70.11 41.36Q69.87 40.87 68.93 40.74L67.25 40.48L67.51 38.72L74.83 38.24L75.26 38.54V56.41Q75.26 57.49 75.56 57.9Q75.86 58.3 76.68 58.43L78.66 58.73V60.5L71.21 60.8L70.65 57.14H70.52Q69.57 58.48 68.52 59.36Q67.46 60.24 66.22 60.67Q64.97 61.1 63.37 61.1ZM81.93 60.5V58.73L83.87 58.43Q84.56 58.3 84.77 57.9Q84.99 57.49 84.99 56.37V43.41Q84.99 41.94 84.73 41.41Q84.47 40.87 83.52 40.74L81.5 40.48L81.76 38.72L88.73 38.24L89.16 38.54L89.51 42.59H89.59Q90.71 40.31 92.39 39.1Q94.07 37.9 96.05 37.9Q98.16 37.9 99.41 39.06Q100.66 40.22 100.66 42.12Q100.66 43.19 100.31 43.99Q99.97 44.79 99.26 45.22Q98.55 45.65 97.51 45.65Q96.18 45.65 95.49 45.09Q94.8 44.53 94.8 43.62Q94.8 43.24 94.93 42.85Q95.06 42.46 95.3 41.94Q95.53 41.43 95.92 40.78Q94.93 40.35 93.88 40.67Q92.82 41 91.92 41.86Q91.01 42.72 90.45 44.01Q89.89 45.3 89.89 46.81V56.45Q89.89 57.44 90.09 57.83Q90.28 58.22 91.01 58.3L94.5 58.78V60.5ZM111.55 61.1Q109.61 61.1 108.3 60.44Q106.99 59.77 106.32 58.33Q105.65 56.88 105.65 54.64V40.78H102.47V38.93Q104.1 38.76 105.14 38Q106.17 37.25 106.73 35.68Q107.29 34.11 107.5 31.61L110.04 31.27L110.56 31.53V38.5H116.97V40.78H110.56V54.09Q110.56 55.94 111.23 56.84Q111.89 57.74 113.44 57.74Q114.48 57.74 115.49 57.38Q116.5 57.01 117.41 56.28L118.31 57.66Q116.97 59.29 115.3 60.2Q113.62 61.1 111.55 61.1ZM130.92 61.1Q127.61 61.1 125.18 59.77Q122.74 58.43 121.45 55.94Q120.16 53.44 120.16 50Q120.16 46.16 121.54 43.47Q122.92 40.78 125.5 39.34Q128.08 37.9 131.57 37.9Q134.76 37.9 137.12 39.21Q139.49 40.52 140.78 43Q142.07 45.47 142.07 48.96Q142.07 52.66 140.72 55.4Q139.36 58.13 136.86 59.62Q134.37 61.1 130.92 61.1ZM131.53 58.82Q133.29 58.82 134.45 57.87Q135.62 56.93 136.2 54.95Q136.78 52.97 136.78 49.95Q136.78 47.45 136.37 45.6Q135.96 43.75 135.19 42.55Q134.41 41.34 133.33 40.74Q132.26 40.14 130.84 40.14Q129.12 40.14 127.91 41.02Q126.7 41.9 126.06 43.8Q125.41 45.69 125.41 48.7Q125.41 52.06 126.17 54.32Q126.92 56.58 128.28 57.7Q129.63 58.82 131.53 58.82ZM145.65 60.5V58.73L147.59 58.43Q148.27 58.3 148.49 57.9Q148.7 57.49 148.7 56.37V43.41Q148.7 41.94 148.45 41.41Q148.19 40.87 147.24 40.74L145.22 40.48L145.48 38.72L152.45 38.24L152.88 38.54L153.23 42.59H153.31Q154.43 40.31 156.11 39.1Q157.79 37.9 159.77 37.9Q161.88 37.9 163.13 39.06Q164.38 40.22 164.38 42.12Q164.38 43.19 164.03 43.99Q163.69 44.79 162.98 45.22Q162.27 45.65 161.23 45.65Q159.9 45.65 159.21 45.09Q158.52 44.53 158.52 43.62Q158.52 43.24 158.65 42.85Q158.78 42.46 159.02 41.94Q159.25 41.43 159.64 40.78Q158.65 40.35 157.59 40.67Q156.54 41 155.64 41.86Q154.73 42.72 154.17 44.01Q153.61 45.3 153.61 46.81V56.45Q153.61 57.44 153.81 57.83Q154 58.22 154.73 58.3L158.22 58.78V60.5ZM176.56 61.1Q173.37 61.1 171.03 59.75Q168.68 58.39 167.43 55.87Q166.18 53.35 166.18 49.91Q166.18 46.16 167.54 43.47Q168.9 40.78 171.35 39.34Q173.8 37.9 177.03 37.9Q179.57 37.9 181.42 38.87Q183.28 39.83 184.31 41.6Q185.34 43.36 185.34 45.78Q185.34 46.59 185.23 47.52Q185.13 48.45 184.91 49.39H171.39Q171.39 52.06 172.21 53.87Q173.03 55.68 174.51 56.58Q176 57.49 177.98 57.49Q179.75 57.49 181.32 56.86Q182.89 56.24 184.35 54.9L185.6 56.19Q184.01 58.56 181.68 59.83Q179.36 61.1 176.56 61.1ZM171.39 47.33H180.35Q180.43 46.85 180.46 46.34Q180.48 45.82 180.48 45.26Q180.48 42.46 179.53 41.17Q178.58 39.88 176.6 39.88Q175.1 39.88 174 40.67Q172.9 41.47 172.23 43.13Q171.57 44.79 171.39 47.33ZM188.79 60.5V58.78L190.72 58.43Q191.41 58.35 191.63 57.94Q191.84 57.53 191.84 56.37V43.36Q191.84 41.86 191.59 41.34Q191.33 40.82 190.38 40.74L188.36 40.48L188.61 38.72L195.68 38.24L196.15 38.54L196.32 42.5H196.45Q197.53 40.35 199.53 39.12Q201.53 37.9 203.9 37.9Q206.22 37.9 207.77 38.76Q209.32 39.62 210.12 41.28Q210.92 42.93 210.92 45.35V56.71Q210.92 57.66 211.17 58.02Q211.43 58.39 212.25 58.48L214.14 58.78V60.5H203.04V58.82L204.76 58.52Q205.53 58.39 205.77 58.02Q206.01 57.66 206.01 56.71V46.16Q206.01 44.23 205.64 43.09Q205.28 41.94 204.41 41.43Q203.55 40.91 202.09 40.91Q200.54 40.91 199.31 41.6Q198.09 42.29 197.42 43.58Q196.75 44.87 196.75 46.64V56.58Q196.75 57.53 196.95 57.92Q197.14 58.3 197.78 58.43L199.85 58.82V60.5Z";
const WORD_WIDTH = 214.14;

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

/** The lighthouse mark on its own. */
export function LogoMark({ size = 24, title, className }: LogoMarkProps) {
  return (
    <svg
      className={cn("k-logo-mark", className)}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {MARK_RECTS.map((r, i) => (
        <rect
          key={i}
          className={r.ink ? "k-logo-ink" : "k-logo-beam"}
          x={r.x}
          y={r.y}
          width={r.w}
          height={r.h}
          rx={r.rx}
          {...(r.faint ? { opacity: 0.3 } : {})}
        />
      ))}
      <path className="k-logo-ink" d={MARK_TOWER} />
    </svg>
  );
}

export interface LogoProps extends LogoMarkProps {
  /** "full" = mark + wordmark (default); "mark" = the mark alone. */
  variant?: "full" | "mark";
}

/** The Vuurtoren logo: the lighthouse mark with the outlined "vuurtoren" wordmark in Literata. */
export function Logo({ variant = "full", size = 24, className, title, ...rest }: LogoProps) {
  if (variant === "mark") {
    return (
      <LogoMark
        size={size}
        title={title ?? "Vuurtoren"}
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
      aria-label={title ?? "Vuurtoren"}
    >
      <LogoMark size={size} {...rest} />
      <svg
        className="k-logo-word"
        width={(size * WORD_WIDTH) / 64}
        height={size}
        viewBox={`0 0 ${WORD_WIDTH} 64`}
        aria-hidden
        focusable="false"
      >
        <path d={WORD_PATH} />
      </svg>
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
 * Kept separate from the mark: the logo is a lighthouse, the ring is for numbers.
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
