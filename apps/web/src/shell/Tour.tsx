/**
 * The first-run walkthrough: five short coach marks after the welcome (Read, a word, the
 * reading help, Words, Review), each with a soft spotlight on its target. Shown once
 * (`vuurtoren.tour`), skippable at every step, and started again from Settings → Reading or
 * the More sheet (`startTour`). A step whose target is not on screen is passed over.
 *
 * While a step shows, a transparent scrim over the whole screen takes every tap, so nothing
 * reaches the page under it; only a step that asks for it (`tap`) leaves its target open, and a
 * tap there goes on to the next step. The bubble sits above sheets (it is rendered into
 * `document.body`, above everything but toasts) and inside the safe areas.
 */
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "@app/ui";
import { readLocal, writeLocal } from "../storage/local.js";
import { useBackClose } from "./backStack.js";

const STATE = "vuurtoren.tour";
const START = "vuurtoren-tour";

interface Step {
  /** Where to point: the first visible match. */
  target: string;
  title: string;
  text: string;
  /** The target takes taps (the scrim has a hole there); a tap on it goes to the next step. */
  tap?: boolean;
}

const STEPS: Step[] = [
  {
    target: ".sidebar .nav-link[href='/']",
    title: "Read",
    text: "Your stories and texts: the story at your level first, then your own.",
  },
  {
    target: ".k-reader .k-tok",
    title: "Tap a word",
    text: "See what it means, hear it, and keep it with Add to my words.",
    tap: true,
  },
  {
    target: ".rbar-mode, .rbar-modes, [aria-label='Reading settings']",
    title: "Help while reading",
    text: "Choose how to read (English above hard words, blanks, side by side) and set the text in Aa.",
  },
  {
    target: ".sidebar .nav-link[href='/review'], .sidebar .nav-link[href='/words']",
    title: "Your words",
    text: "Every word you keep, by level, with how many you know.",
  },
  {
    target: ".sidebar .nav-link[href='/review'], .sidebar .nav-link[href='/words']",
    title: "Review",
    text: "Your daily cards, a few minutes a day. The dot on Words says cards are waiting.",
  },
];

/** Room (px) between the bubble and the screen's edges or safe areas. */
const EDGE = 16;
const PAD = 6;

/** Show the walkthrough after the welcome (once), or again when asked. */
export function startTour(): void {
  writeLocal(STATE, "pending");
  window.dispatchEvent(new Event(START));
}

function visible(selector: string): Element | null {
  for (const el of document.querySelectorAll(selector)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden") return el;
  }
  return null;
}

/** A tap on the scrim stops there: the page under the walkthrough never sees it. */
function swallow(e: SyntheticEvent): void {
  e.preventDefault();
  e.stopPropagation();
}

export function Tour() {
  const [on, setOn] = useState(() => readLocal(STATE) === "pending");
  const [at, setAt] = useState(0);
  // The target's box, with the step it belongs to (a new step waits for its own target).
  const [spot, setSpot] = useState<{ at: number; rect: DOMRect } | null>(null);
  // The safe box (inside --safe-*) and the bubble's height, to keep the bubble on screen.
  const safeRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ safe: DOMRect; card: number } | null>(null);

  useEffect(() => {
    const start = () => {
      setAt(0);
      setOn(true);
    };
    window.addEventListener(START, start);
    return () => window.removeEventListener(START, start);
  }, []);

  const end = () => {
    writeLocal(STATE, "done");
    setOn(false);
  };
  const next = () => {
    if (at + 1 < STEPS.length) setAt(at + 1);
    else end();
  };
  // Android Back ends the walkthrough before it closes anything under it.
  useBackClose(on, end);

  // Follow the target (pages load, sheets move, the window turns); pass over a missing one
  // after a moment.
  useLayoutEffect(() => {
    if (!on) return;
    let missing = 0;
    const find = () => {
      const step = STEPS[at];
      if (!step) return;
      const el = visible(step.target);
      if (el) {
        missing = 0;
        const r = el.getBoundingClientRect();
        setSpot((old) =>
          old?.at === at &&
          old.rect.x === r.x &&
          old.rect.y === r.y &&
          old.rect.width === r.width &&
          old.rect.height === r.height
            ? old
            : { at, rect: r },
        );
      } else if (++missing > 10) {
        missing = 0;
        if (at + 1 < STEPS.length) setAt(at + 1);
        else {
          writeLocal(STATE, "done");
          setOn(false);
        }
      } else setSpot(null);
    };
    const first = window.requestAnimationFrame(find);
    const timer = window.setInterval(find, 250);
    return () => {
      window.cancelAnimationFrame(first);
      window.clearInterval(timer);
    };
  }, [on, at]);

  // Measure the safe box and the bubble once they are on screen (and when they change).
  useLayoutEffect(() => {
    const safe = safeRef.current?.getBoundingClientRect();
    const card = cardRef.current?.offsetHeight ?? 0;
    if (!safe) return;
    setFit((old) =>
      old &&
      old.card === card &&
      old.safe.top === safe.top &&
      old.safe.bottom === safe.bottom &&
      old.safe.left === safe.left &&
      old.safe.right === safe.right
        ? old
        : { safe, card },
    );
  }, [on, at, spot]);

  // A tap on the target of a `tap` step goes on (the tap itself still reaches the target).
  useEffect(() => {
    const step = STEPS[at];
    if (!on || !step?.tap) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target?.closest(step.target)) setAt((a) => (a === at ? a + 1 : a));
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [on, at]);

  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        writeLocal(STATE, "done");
        setOn(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [on]);

  const step = STEPS[at];
  const rect = spot?.at === at ? spot.rect : null;
  if (!on || !step || !rect) return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const safe = fit?.safe ?? { top: 0, bottom: vh, left: 0, right: vw };
  const width = Math.min(320, safe.right - safe.left - 2 * EDGE);
  const left = Math.min(
    Math.max(safe.left + EDGE, rect.left + rect.width / 2 - width / 2),
    safe.right - width - EDGE,
  );
  // Below the target when it is in the top half, else above it; always inside the safe box.
  const below = rect.top + rect.height / 2 < vh / 2;
  const height = fit?.card ?? 0;
  const wanted = below ? rect.bottom + PAD + 12 : rect.top - PAD - 12 - height;
  const top = Math.max(safe.top + EDGE, Math.min(wanted, safe.bottom - EDGE - height));
  const last = at === STEPS.length - 1;
  const hole = {
    top: rect.top - PAD,
    left: rect.left - PAD,
    right: rect.right + PAD,
    bottom: rect.bottom + PAD,
  };
  const scrim = (style: CSSProperties, key: string) => (
    <div
      key={key}
      className="tour-scrim"
      data-testid="tour-scrim"
      style={style}
      onPointerDown={(e: ReactPointerEvent) => swallow(e)}
      onPointerUp={swallow}
      onClick={swallow}
      onTouchStart={(e) => e.stopPropagation()}
    />
  );

  return createPortal(
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <div className="tour-safe" ref={safeRef} aria-hidden />
      {step.tap
        ? [
            scrim({ top: 0, left: 0, right: 0, height: Math.max(0, hole.top) }, "t"),
            scrim({ top: hole.bottom, left: 0, right: 0, bottom: 0 }, "b"),
            scrim(
              {
                top: hole.top,
                left: 0,
                width: Math.max(0, hole.left),
                height: hole.bottom - hole.top,
              },
              "l",
            ),
            scrim(
              { top: hole.top, left: hole.right, right: 0, height: hole.bottom - hole.top },
              "r",
            ),
          ]
        : scrim({ inset: 0 }, "all")}
      <div
        className="tour-spot"
        aria-hidden
        style={{
          top: hole.top,
          left: hole.left,
          width: hole.right - hole.left,
          height: hole.bottom - hole.top,
        }}
      />
      <div key={at} ref={cardRef} className="tour-card" style={{ left, width, top }}>
        <p className="tour-count">
          {at + 1} of {STEPS.length}
        </p>
        <h2 className="tour-title" id="tour-title">
          {step.title}
        </h2>
        <p className="tour-text">{step.text}</p>
        <div className="tour-actions">
          <button type="button" className="tour-skip" onClick={end}>
            Skip the tour
          </button>
          <Button variant="primary" size="sm" onClick={next} autoFocus>
            {last ? "Done" : "Next"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
