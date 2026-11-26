import { type MouseEvent, type PointerEvent, useRef } from "react";

/** How long a finger stays down before it counts as a long press (as in the Sentence tab). */
export const LONG_PRESS_MS = 450;
/** A finger that moves further than this is scrolling, not pressing. */
const MOVE_PX = 10;

/**
 * A long press with a finger (touch or pen, never the mouse): `onLong` after LONG_PRESS_MS.
 * Moving the finger (a scroll) cancels it. The click that follows a long press is stopped, and
 * so is Android's own context menu, which a long press would open.
 */
export function useLongPress(onLong: (() => void) | undefined) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };
  if (!onLong) return {};
  return {
    onPointerDown: (e: PointerEvent) => {
      fired.current = false;
      if (e.pointerType === "mouse") return;
      clear();
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        timer.current = null;
        fired.current = true;
        navigator.vibrate?.(10);
        onLong();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e: PointerEvent) => {
      const s = start.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_PX) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onContextMenu: (e: MouseEvent) => {
      if (start.current || fired.current) e.preventDefault();
    },
    onClickCapture: (e: MouseEvent) => {
      if (!fired.current) return;
      fired.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}
