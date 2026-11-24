/**
 * Swipe a card to answer: left, right or up past a threshold, or a quick flick a shorter way,
 * calls the matching action; a slow, short drag springs back. The handlers go on the whole
 * screen, so a swipe can start anywhere, on a button too: the pointer is captured only once it
 * moves, so a tap stays a tap. The card follows the finger (or mouse) and tilts a little, and
 * `direction` names the answer it would give, so the screen can show it before letting go.
 *
 * On letting go the card stays where the finger left it and flies off the way it was thrown;
 * the action runs once it is gone, so even a quick flick shows the card leave.
 */
import {
  type CSSProperties,
  type PointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/** How far (px) a drag must go to count as a swipe. */
const THRESHOLD = 90;
/** A flick: at least this far (px) … */
const FLICK_MIN = 28;
/** … and this fast (px per ms) at the end. */
const FLICK_SPEED = 0.45;
/** Below this (px) a press is a tap; a finger moves more than a mouse while it taps. */
const MOVES = 10;
const MOVES_TOUCH = 16;
/** A drag that ends this close to where it started, without a swipe, was a tap after all. */
const STILL_A_TAP = 24;
/** How long the card takes to fly off (ms). */
const LEAVE_MS = 220;

type Direction = "left" | "right" | "up";

export function useSwipe(opts: {
  enabled: boolean;
  onLeft: () => void;
  onRight: () => void;
  onUp: () => void;
  /**
   * A press that moved a little but was no swipe: on a phone the finger moves while it taps,
   * and once the pointer was captured the card's own click never came (two taps to show the
   * answer). `target` is where the press started.
   */
  onTap?: (target: EventTarget | null) => void;
}) {
  const start = useRef<{
    x: number;
    y: number;
    id: number;
    moved: boolean;
    touch: boolean;
    target: EventTarget | null;
  } | null>(null);
  /** The last two moves, for the speed at letting go. */
  const trail = useRef<{ x: number; y: number; t: number }[]>([]);
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
  /** Flying off: where to, and the answer to give once there. */
  const [leaving, setLeaving] = useState<{ x: number; y: number; dir: Direction } | null>(null);
  const actions = useRef(opts);
  useLayoutEffect(() => {
    actions.current = opts;
  });

  useEffect(() => {
    if (!leaving) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const t = window.setTimeout(
      () => {
        setLeaving(null);
        setOffset(null);
        const a = actions.current;
        if (leaving.dir === "left") a.onLeft();
        else if (leaving.dir === "right") a.onRight();
        else a.onUp();
      },
      still ? 0 : LEAVE_MS,
    );
    return () => window.clearTimeout(t);
  }, [leaving]);

  const directionOf = (x: number, y: number, at: number): Direction | null => {
    if (Math.abs(x) >= at && Math.abs(x) > Math.abs(y)) return x < 0 ? "left" : "right";
    if (-y >= at && -y > Math.abs(x)) return "up";
    return null;
  };

  const handlers = {
    onPointerDown(e: PointerEvent<HTMLElement>) {
      if (!opts.enabled || leaving) return;
      start.current = {
        x: e.clientX,
        y: e.clientY,
        id: e.pointerId,
        moved: false,
        touch: e.pointerType === "touch",
        target: e.target,
      };
      trail.current = [{ x: e.clientX, y: e.clientY, t: e.timeStamp }];
    },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      const s = start.current;
      if (!s || s.id !== e.pointerId) return;
      const x = e.clientX - s.x;
      const y = e.clientY - s.y;
      if (!s.moved) {
        if (Math.hypot(x, y) < (s.touch ? MOVES_TOUCH : MOVES)) return;
        s.moved = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }
      trail.current = [...trail.current.slice(-1), { x: e.clientX, y: e.clientY, t: e.timeStamp }];
      setOffset({ x, y: Math.min(0, y) });
    },
    onPointerUp(e: PointerEvent<HTMLElement>) {
      const s = start.current;
      start.current = null;
      if (!s || s.id !== e.pointerId || !s.moved) return;
      const x = e.clientX - s.x;
      const y = Math.min(0, e.clientY - s.y);
      const [a, b] = trail.current;
      const dt = a && b ? Math.max(1, b.t - a.t) : 0;
      // Fast at the end, and let go while still moving (not after holding still).
      const fast =
        !!dt &&
        e.timeStamp - b!.t < 100 &&
        Math.hypot(b!.x - a!.x, b!.y - a!.y) / dt >= FLICK_SPEED;
      const dir = directionOf(x, y, THRESHOLD) ?? (fast ? directionOf(x, y, FLICK_MIN) : null);
      if (!dir) {
        setOffset(null);
        if (Math.hypot(e.clientX - s.x, e.clientY - s.y) < STILL_A_TAP) opts.onTap?.(s.target);
        return;
      }
      // Off screen along the throw: far enough that it is gone, from where it was let go.
      const far = Math.max(window.innerWidth, window.innerHeight) * 1.1;
      setOffset({ x, y });
      setLeaving(
        dir === "up"
          ? { x: x * 0.5, y: -far, dir }
          : { x: Math.sign(x) * far, y: y + (y / Math.max(1, Math.abs(x))) * far * 0.3, dir },
      );
    },
    onPointerCancel() {
      start.current = null;
      if (!leaving) setOffset(null);
    },
  };

  const style: CSSProperties | undefined = leaving
    ? {
        transform: `translate(${leaving.x}px, ${leaving.y}px) rotate(${leaving.x / 30}deg)`,
        transition: `transform ${LEAVE_MS}ms cubic-bezier(0.3, 0.6, 0.4, 1)`,
        pointerEvents: "none",
      }
    : opts.enabled && offset
      ? {
          transform: `translate(${offset.x}px, ${offset.y}px) rotate(${offset.x / 30}deg)`,
          transition: "none",
        }
      : undefined;

  const shown = leaving ?? offset;
  return {
    handlers,
    style,
    leaving: !!leaving,
    direction: leaving ? leaving.dir : shown ? directionOf(shown.x, shown.y, THRESHOLD / 2) : null,
  };
}
