/**
 * The first-run walkthrough: five short coach marks after the welcome (Read, a word, the
 * reading help, Words, and Due today on the Words page), each with a soft spotlight on its
 * target. The Words step can be followed: a tap on Words, or "Go to Words", opens the page the
 * last step is about. Shown once
 * (`vuurtoren.tour`), skippable at every step, and started again from Settings → Reading or
 * the More sheet (`startTour`). It has a known start wherever it begins: the reader steps open
 * the learner's current story themselves (Continue reading, else the story at their level) when
 * no reader is on screen. A target outside the screen is scrolled into view; a step whose target
 * never shows is passed over. The bubble stays inside the screen (its text scrolls when there is
 * little room), and the focus moves to each step so a screen reader reads it.
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
import { Button, useNativeMode } from "@app/ui";
import { useNavigate } from "@tanstack/react-router";
import { readLocal, writeLocal } from "../storage/local.js";
import { readLastText } from "../lastText.js";
import { useServices } from "../services/context.js";
import { storyToStart } from "../services/stories.js";
import type { AppServices } from "../services/types.js";
import { pickContinue } from "../textPages.js";
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
  /** The step is about the reader: without one on screen, the current story opens. */
  reader?: boolean;
  /** The step is about this page: the walkthrough opens it when the target is not on screen. */
  route?: "/words";
  /** The Next button's label (it goes where the step points). */
  go?: string;
  /** The title and text with Anki keeping the cards (reviews happen in Anki). */
  ankiTitle?: string;
  ankiText?: string;
}

const STEPS: Step[] = [
  {
    target: ".sidebar .nav-link[href='/']",
    title: "Read",
    text: "Stories at your level and your own texts. On top: what to continue and what is due today.",
  },
  {
    target: ".k-reader .k-tok",
    title: "Tap a word",
    text: "See its meaning in its sentence, and hear it. Pull the sheet up for its grammar and Explain this sentence.",
    tap: true,
    reader: true,
  },
  {
    target: ".rbar-mode, .rbar-modes, [aria-label='Reading settings']",
    reader: true,
    title: "Help while reading",
    text: "Choose how to read (English above hard words, blanks, side by side) and set the text in Aa.",
  },
  {
    target: ".sidebar .nav-link[href='/words']",
    title: "Words",
    text: "Your daily cards and all your words, in one place. The dot says cards are waiting.",
    tap: true,
    go: "Go to Words",
  },
  {
    target: ".due-today",
    route: "/words",
    title: "Due today",
    text: "Your cards for today: reviews first, then a few new words. Press Start, then swipe: left Again, right Good, up Easy. Done early? Go on with more.",
    ankiTitle: "Your words",
    ankiText: "Your cards are reviewed in Anki. Here are your word lists, Practice and your level.",
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
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden") {
      // Outside the screen (a long page, a short landscape screen): bring it into view first.
      if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth)
        el.scrollIntoView?.({ block: "center", inline: "nearest" });
      return el;
    }
  }
  return null;
}

/** The learner's current story: Continue reading, else the story at their level (opened). */
async function currentStory(services: AppServices): Promise<string | null> {
  const cont = pickContinue(await services.listTexts(), readLastText());
  if (cont) return cont.text.id;
  const story = storyToStart(await services.storyShelf());
  return story ? services.openStory(story.slug) : null;
}

/** A tap on the scrim stops there: the page under the walkthrough never sees it. */
function swallow(e: SyntheticEvent): void {
  e.preventDefault();
  e.stopPropagation();
}

export function Tour() {
  const services = useServices();
  const navigate = useNavigate();
  const native = useNativeMode();
  // The step whose page the walkthrough opened (once per step).
  const routed = useRef(-1);
  // The reader steps open a story once per start of the tour (then wait for it to load).
  const opening = useRef<"no" | "busy" | "done">("no");
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
      opening.current = "no";
      routed.current = -1;
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
      if (!el && step.route) {
        if (routed.current !== at) {
          routed.current = at;
          void navigate({ to: step.route });
        }
        missing = 0;
        setSpot(null);
        return;
      }
      if (!el && step.reader && !document.querySelector(".k-reader")) {
        // A known start: the reader steps bring their own story.
        if (opening.current === "no") {
          opening.current = "busy";
          void currentStory(services)
            .then((textId) => {
              if (textId) void navigate({ to: "/read/$textId", params: { textId } });
            })
            .catch(() => undefined)
            .finally(() => {
              opening.current = "done";
            });
        }
        if (opening.current === "busy") {
          missing = 0;
          setSpot(null);
          return;
        }
      }
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
  }, [on, at, services, navigate]);

  // Each step takes the focus, so a screen reader reads its title and text.
  useEffect(() => {
    if (on && spot?.at === at) cardRef.current?.focus({ preventScroll: true });
  }, [on, at, spot?.at]);

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
      <div
        key={at}
        ref={cardRef}
        className="tour-card"
        style={{ left, width, top, maxHeight: safe.bottom - safe.top - 2 * EDGE }}
        role="group"
        tabIndex={-1}
        aria-labelledby="tour-title"
        aria-describedby="tour-text"
      >
        <p className="tour-count">
          {at + 1} of {STEPS.length}
        </p>
        <h2 className="tour-title" id="tour-title">
          {!native && step.ankiTitle ? step.ankiTitle : step.title}
        </h2>
        <p className="tour-text" id="tour-text">
          {!native && step.ankiText ? step.ankiText : step.text}
        </p>
        <div className="tour-actions">
          <button type="button" className="tour-skip" onClick={end}>
            Skip the tour
          </button>
          <Button variant="primary" size="sm" onClick={next}>
            {last ? "Done" : (step.go ?? "Next")}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
