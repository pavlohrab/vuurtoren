/**
 * The first-run walkthrough: five short coach marks after the welcome (Read, a word, the
 * reading help, Words, Review), each with a soft spotlight on its target. Shown once
 * (`vuurtoren.tour`), skippable at every step, and started again from Settings → Reading or
 * the More sheet (`startTour`). A step whose target is not on screen is passed over.
 */
import { useEffect, useLayoutEffect, useState } from "react";
import { Button } from "@app/ui";
import { readLocal, writeLocal } from "../storage/local.js";

const STATE = "vuurtoren.tour";
const START = "vuurtoren-tour";

interface Step {
  /** Where to point: the first visible match. */
  target: string;
  title: string;
  text: string;
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

export function Tour() {
  const [on, setOn] = useState(() => readLocal(STATE) === "pending");
  const [at, setAt] = useState(0);
  // The target's box, with the step it belongs to (a new step waits for its own target).
  const [spot, setSpot] = useState<{ at: number; rect: DOMRect } | null>(null);

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
          old?.at === at && old.rect.x === r.x && old.rect.y === r.y && old.rect.width === r.width
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
  const pad = 6;
  const below = rect.top + rect.height / 2 < window.innerHeight / 2;
  const width = Math.min(320, window.innerWidth - 32);
  const left = Math.min(
    Math.max(16, rect.left + rect.width / 2 - width / 2),
    window.innerWidth - width - 16,
  );
  const last = at === STEPS.length - 1;
  return (
    <div className="tour" role="dialog" aria-modal="false" aria-labelledby="tour-title">
      <div
        className="tour-spot"
        aria-hidden
        style={{
          top: rect.top - pad,
          left: rect.left - pad,
          width: rect.width + 2 * pad,
          height: rect.height + 2 * pad,
        }}
      />
      <div
        key={at}
        className="tour-card"
        style={{
          left,
          width,
          ...(below
            ? { top: rect.bottom + pad + 12 }
            : { bottom: window.innerHeight - rect.top + pad + 12 }),
        }}
      >
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
          <Button
            variant="primary"
            size="sm"
            onClick={() => (last ? end() : setAt(at + 1))}
            autoFocus
          >
            {last ? "Done" : "Next"}
          </Button>
        </div>
      </div>
    </div>
  );
}
