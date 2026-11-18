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
