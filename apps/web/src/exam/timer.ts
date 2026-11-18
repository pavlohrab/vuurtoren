/** The exam clock: a countdown that survives re-renders and reports when time is up. */
import { useEffect, useRef, useState } from "react";

/** "mm:ss" (or "h:mm:ss" from an hour), rounding up so 0:00 means time is up. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/** Milliseconds left of `limitMs` after `elapsedMs` (never below 0). */
export function remainingMs(limitMs: number, elapsedMs: number): number {
  return Math.max(0, limitMs - elapsedMs);
}

/**
 * A ticking clock. `limitMs` null = count up only (practice). `onExpire` fires once when a limit
 * is reached while running. Returns elapsed and remaining time in ms.
 */
export function useExamClock(
  limitMs: number | null,
  running: boolean,
  onExpire?: () => void,
  tickMs = 250,
): { elapsed: number; remaining: number | null } {
  const [elapsed, setElapsed] = useState(0);
  const base = useRef(0);
  const startedAt = useRef<number | null>(null);
  const expired = useRef(false);
  const expire = useRef(onExpire);
  useEffect(() => {
    expire.current = onExpire;
  });

  useEffect(() => {
    if (!running) return;
    startedAt.current = Date.now();
    const tick = () => {
      const e = base.current + (Date.now() - (startedAt.current ?? Date.now()));
      setElapsed(e);
      if (limitMs !== null && e >= limitMs && !expired.current) {
        expired.current = true;
        expire.current?.();
      }
    };
    const id = setInterval(tick, tickMs);
    return () => {
      clearInterval(id);
      base.current += Date.now() - (startedAt.current ?? Date.now());
      startedAt.current = null;
    };
  }, [running, limitMs, tickMs]);

  return { elapsed, remaining: limitMs === null ? null : remainingMs(limitMs, elapsed) };
}
