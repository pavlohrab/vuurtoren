/**
 * A speed report (SPEED, before RL0): how long the start took, step by step, and which data calls
 * are slow. Every call of the app's services and, in the computer app, every database call is
 * timed in memory (count, total, slowest); nothing is sent anywhere. Settings → Data → Advanced
 * shows it with a Copy button, to paste into feedback.
 */

interface Stat {
  n: number;
  total: number;
  max: number;
}

const stats = new Map<string, Stat>();
const marks: [string, number][] = [];

function add(name: string, ms: number): void {
  const s = stats.get(name) ?? { n: 0, total: 0, max: 0 };
  s.n += 1;
  s.total += ms;
  if (ms > s.max) s.max = ms;
  stats.set(name, s);
}

/** A step of the start, in ms since the page began loading. */
export function mark(step: string): void {
  marks.push([step, Math.round(performance.now())]);
}

/**
 * The same object, with every function timed under `prefix.name` (async ones until they
 * settle). Anything else passes through untouched.
 */
export function timed<T extends object>(obj: T, prefix: string): T {
  // One timed function per original, so each looks the same on every read (React compares them).
  const made = new WeakMap<object, unknown>();
  return new Proxy(obj, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver);
      if (typeof value !== "function" || typeof key !== "string") return value;
      const known = made.get(value);
      if (known) return known;
      const name = `${prefix}.${key}`;
      const wrapped = function (this: unknown, ...args: unknown[]) {
        const t0 = performance.now();
        const out: unknown = (value as (...a: unknown[]) => unknown).apply(
          this === receiver ? target : this,
          args,
        );
        if (out instanceof Promise) return out.finally(() => add(name, performance.now() - t0));
        add(name, performance.now() - t0);
        return out;
      };
      made.set(value, wrapped);
      return wrapped;
    },
  });
}

/** The report: the start, then the calls that took the most time in all. */
export function speedReport(top = 25): string {
  const lines = [
    `Speed report, ${new Date().toISOString()}`,
    `${navigator.userAgent}`,
    "",
    "Start (ms since load):",
  ];
  for (const [step, at] of marks) lines.push(`  ${String(at).padStart(6)}  ${step}`);
  lines.push("", "Calls (total ms · count · slowest ms · name):");
  const rows = [...stats.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, top);
  for (const [name, s] of rows)
    lines.push(
      `  ${String(Math.round(s.total)).padStart(7)} · ${String(s.n).padStart(5)} · ${String(Math.round(s.max)).padStart(5)} · ${name}`,
    );
  return lines.join("\n");
}

/**
 * About once a week, after the start: compaction (drops what later events made useless, and the
 * starter words other devices added again) also on a device that never syncs. In the
 * background; a failure just waits for next week.
 */
export function compactNowAndThen(repo: { compact(): Promise<unknown> }): void {
  const KEY = "vuurtoren.compacted";
  const WEEK = 7 * 86_400_000;
  try {
    const last = Number(localStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < WEEK) return;
    setTimeout(() => {
      void repo
        .compact()
        .then(() => localStorage.setItem(KEY, String(Date.now())))
        .catch(() => {});
    }, 20_000);
  } catch {
    // No storage: skip.
  }
}
