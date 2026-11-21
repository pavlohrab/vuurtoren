/**
 * Touch: a swipe left turns to the next page, a swipe right to the previous one. Only clear
 * horizontal swipes count (at least 64px, mostly sideways, under 600 ms); a swipe that starts on
 * the selected word, on a control, or while text is selected is left alone. Keys and the ‹ ›
 * buttons work as before; the page slides in (`.reader-turn`, ReaderPage.tsx).
 */
import { useEffect, useRef } from "react";

const MIN_DX = 64;
const MAX_MS = 600;
const IGNORE =
  "[data-selected='true'], input, textarea, select, [role=slider], .reader-footer, .k-popover";

/** Is this movement a page swipe? Returns its direction (1 = next page), or 0. */
export function swipeDirection(dx: number, dy: number, ms: number): 1 | -1 | 0 {
  if (ms > MAX_MS || Math.abs(dx) < MIN_DX || Math.abs(dx) < 2 * Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}

export function useSwipePages(el: HTMLElement | null, step: (dir: 1 | -1) => void): void {
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  });
  useEffect(() => {
    if (!el) return;
    let start: { x: number; y: number; t: number; id: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || !e.isPrimary) return;
      if ((e.target as Element).closest(IGNORE)) return;
      start = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId };
    };
    const onUp = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const s = start;
      start = null;
      if (window.getSelection()?.toString()) return;
      const dir = swipeDirection(e.clientX - s.x, e.clientY - s.y, e.timeStamp - s.t);
      if (!dir) return;
      // The tap that ends a swipe on a word does not open the word.
      const swallow = (c: MouseEvent) => {
        c.stopPropagation();
        c.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, true), 400);
      stepRef.current(dir);
    };
    const onCancel = () => {
      start = null;
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onCancel);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onCancel);
    };
  }, [el]);
}
