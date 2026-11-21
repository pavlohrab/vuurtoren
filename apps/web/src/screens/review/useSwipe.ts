/**
 * Swipe a card to answer: left, right or up past a threshold calls the matching action; a
 * shorter drag springs back. The handlers go on the whole screen, so a swipe can start anywhere,
 * on a button too: the pointer is captured only once it moves, so a tap stays a tap. The card follows the finger (or mouse) and tilts a little, and
 * `direction` names the answer it would give, so the screen can show it before letting go.
 */
import { type CSSProperties, type PointerEvent, useRef, useState } from "react";

/** How far (px) a drag must go to count as a swipe. */
const THRESHOLD = 90;
/** Below this (px) a press is a tap. */
const MOVES = 10;

type Direction = "left" | "right" | "up";

export function useSwipe(opts: {
  enabled: boolean;
  onLeft: () => void;
  onRight: () => void;
  onUp: () => void;
}) {
  const start = useRef<{ x: number; y: number; id: number; moved: boolean } | null>(null);
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);

  const directionOf = (x: number, y: number, at: number): Direction | null => {
    if (Math.abs(x) >= at && Math.abs(x) > Math.abs(y)) return x < 0 ? "left" : "right";
    if (-y >= at && -y > Math.abs(x)) return "up";
    return null;
  };

  const handlers = {
    onPointerDown(e: PointerEvent<HTMLElement>) {
      if (!opts.enabled) return;
      start.current = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false };
    },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      const s = start.current;
      if (!s || s.id !== e.pointerId) return;
      const x = e.clientX - s.x;
      const y = e.clientY - s.y;
      if (!s.moved) {
        if (Math.hypot(x, y) < MOVES) return;
        s.moved = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }
      setOffset({ x, y: Math.min(0, y) });
    },
    onPointerUp(e: PointerEvent<HTMLElement>) {
      const s = start.current;
      start.current = null;
      if (!s || s.id !== e.pointerId || !s.moved) return;
      const dir = directionOf(e.clientX - s.x, e.clientY - s.y, THRESHOLD);
      setOffset(null);
      if (dir === "left") opts.onLeft();
      else if (dir === "right") opts.onRight();
      else if (dir === "up") opts.onUp();
    },
    onPointerCancel() {
      start.current = null;
      setOffset(null);
    },
  };

  const style: CSSProperties | undefined = opts.enabled
    ? {
        ...(offset
          ? {
              transform: `translate(${offset.x}px, ${offset.y}px) rotate(${offset.x / 30}deg)`,
              transition: "none",
            }
          : {}),
      }
    : undefined;

  return {
    handlers,
    style,
    direction: offset ? directionOf(offset.x, offset.y, THRESHOLD / 2) : null,
  };
}
