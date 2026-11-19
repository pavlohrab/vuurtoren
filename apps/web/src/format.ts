/** Small display formatters shared by the screens. */

/** 0.734 -> "73%". */
export const pct = (v: number): string => `${Math.round(v * 100)}%`;

/** plural(1, "word") -> "1 word", plural(3, "word") -> "3 words". */
export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;

/** "12.3 MB" style size. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["minute", 60],
  ["hour", 24],
  ["day", 7],
];

/**
 * A past moment in plain words: "just now", "5 minutes ago", "yesterday", then a locale date
 * ("12 Nov") after a week.
 */
export function relativeTime(ms: number, now = Date.now()): string {
  let v = Math.max(0, (now - ms) / 60_000);
  if (v < 1) return "just now";
  for (const [unit, next] of STEPS) {
    if (v < next) return RELATIVE.format(-Math.floor(v), unit);
    v /= next;
  }
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(d.getFullYear() !== new Date(now).getFullYear() ? { year: "numeric" } : {}),
  });
}
