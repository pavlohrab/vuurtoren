/**
 * The first-run walkthrough (OB9, mock C of `mock-card-onboarding-tour.html`): ten short steps,
 * each lighting up one thing with one line. In the story you opened: tap a word, its card, the
 * sentence and its grammar, Aa, the reading modes, then Cloze, Gloss and Side by side, which the
 * tour switches on for you (Read comes back at the end). Then Read and Words. Steps you can do
 * yourself say "Try it" and go on when you tap. Shown once (`vuurtoren.tour`), skippable at every
 * step, and started again from Settings → Reading or the More sheet (`startTour`). It has a known
 * start wherever it begins: the reader steps open the learner's current story themselves
 * (Continue reading, else the story at their level) when no reader is on screen. A target outside
 * the screen is scrolled into view; a step whose target never shows is passed over. The bubble
 * stays inside the screen (its text scrolls when there is little room), and the focus moves to
 * each step so a screen reader reads it.
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
import { Button, type ReaderMode, useNativeMode } from "@app/ui";
import { useNavigate } from "@tanstack/react-router";
import { readLocal, writeLocal } from "../storage/local.js";
import { readLastText } from "../lastText.js";
import { useServices } from "../services/context.js";
import { storyToStart } from "../services/stories.js";
import type { AppServices } from "../services/types.js";
import { pickContinue } from "../textPages.js";
import { useBackClose } from "./backStack.js";
import { useShell } from "./ShellContext.js";

const STATE = "vuurtoren.tour";
const START = "vuurtoren-tour";

interface Step {
  /** Where to point: the first visible match; "a || b" tries a first, then b. */
  target: string;
  title: string;
  text: string;
  /** The target takes taps (the scrim has a hole there); a tap on it goes to the next step. */
  tap?: boolean;
  /** The step is about the reader: without one on screen, the current story opens. */
  reader?: boolean;
  /** The step is about this page: the walkthrough opens it when the target is not on screen. */
  route?: "/" | "/words";
  /** The Next button's label (it goes where the step points). */
  go?: string;
  /** The title and text with Anki keeping the cards (reviews happen in Anki). */
  ankiTitle?: string;
  ankiText?: string;
  /** What the tour does as the step begins: switch the reading mode, show a tab, close the card. */
  enter?: {
    mode?: ReaderMode;
    /** Clicked one after another; each entry is a list of selectors, the first found wins. */
    click?: string[][];
    /** Nothing is clicked when this is on screen already. */
    unless?: string;
    closeCard?: boolean;
  };
}

const STEPS: Step[] = [
  // The story you opened comes first; Read, then Words, after it (D4).
  {
    target: ".k-reader .k-tok",
    title: "Tap a word",
    text: "See what it means here.",
    tap: true,
    reader: true,
  },
  {
    target: ".inspector-panel .k-inspector-head, .inspector-panel",
    reader: true,
    title: "Its card",
    text: "The word, and what it means in this sentence. Study first to learn it.",
    // Next on step 1 instead of a tap: the tour opens a word's card itself.
    enter: {
      click: [
        [
          '.k-reader .k-tok[data-label="introduce"]',
          '.k-reader .k-tok[data-label="new"]',
          ".k-reader .k-tok[data-i]",
        ],
      ],
      unless: ".inspector-panel .k-inspector-head",
    },
  },
  {
    target: "#k-panel-sentence .sframe || #k-panel-sentence",
    reader: true,
    title: "The sentence and its grammar",
    text: "The sentence part by part. In the text, a line beside a sentence marks grammar: tap it to focus on it, or open the topic.",
    // Pull the card up (the phone's peek hides the tab), then the Sentence tab.
    enter: { click: [["[aria-label='Show all of the word panel']"], ["#k-tab-sentence"]] },
  },
  {
    target: "[aria-label='Reading settings']",
    reader: true,
    title: "Aa: how the page looks",
    text: "Text size, how many new words, and the grammar lines.",
    enter: { closeCard: true },
  },
  {
    target: ".rbar-mode, .rbar-modes",
    reader: true,
    title: "Four ways to read",
    text: "Choose how much help you get. Here are three of them.",
  },
  {
    target: ".k-reader",
    reader: true,
    title: "Cloze",
    text: "Words you know well become blanks. Fill them in.",
    enter: { mode: "cloze" },
  },
  {
    target: ".k-reader",
    reader: true,
    title: "Gloss",
    text: "The English sits above the words you may not know.",
    enter: { mode: "gloss" },
  },
  {
    target: ".k-sbs, .k-reader",
    reader: true,
    title: "Side by side",
    text: "Tap a sentence to see it in English.",
    tap: true,
    enter: { mode: "side" },
  },
  {
    // The Read page, after the story: where "on top" is.
    target: ".today-continue",
    route: "/",
    title: "Read",
    text: "Your story waits on top. Below, stories at your level, and your own texts.",
    enter: { mode: "read", closeCard: true },
  },
  {
    target: ".due-today",
    route: "/words",
    title: "Words",
    text: "Review today's cards here. Check your level once, so Vuurtoren knows which words to help you with.",
    ankiTitle: "Words",
    ankiText: "You review your cards in Anki. Here are your words, Practice, and Check your level.",
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
  const choices = selector.split("||").map((c) => c.trim());
  if (choices.length > 1) {
    for (const c of choices) {
      const el = visible(c);
      if (el) return el;
    }
    return null;
  }
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
  const shell = useShell();
  // The step whose page the walkthrough opened (once per step).
  const routed = useRef(-1);
  // The step whose action (`enter`) has run.
  const entered = useRef(-1);
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
      entered.current = -1;
      setAt(0);
      setOn(true);
    };
    window.addEventListener(START, start);
    return () => window.removeEventListener(START, start);
  }, []);

  const end = () => {
    writeLocal(STATE, "done");
    setOn(false);
    // The tour switched the reading mode for its steps: Read again when it ends early.
    if (STEPS.some((st, k) => k <= at && st.enter?.mode && st.enter.mode !== "read"))
      shell.setMode("read");
  };
  const next = () => {
    if (at + 1 < STEPS.length) setAt(at + 1);
    else end();
  };
  // Android Back ends the walkthrough before it closes anything under it.
  useBackClose(on, end);

  // What a step does as it begins (once): a reading mode, a tab, the card closed.
  useEffect(() => {
    const step = STEPS[at];
    if (!on || !step?.enter || entered.current === at) return;
    entered.current = at;
    const { mode, click, unless, closeCard } = step.enter;
    if (closeCard) shell.setInspectorOpen(false);
    if (mode) shell.setMode(mode);
    if (click && !(unless && document.querySelector(unless))) {
      // One after another, a moment apart, so each click's effect is on screen for the next.
      click.forEach((choices, k) =>
        window.setTimeout(() => {
          const el = choices.map((c) => document.querySelector(c)).find(Boolean);
          (el as HTMLElement | null | undefined)?.click();
        }, k * 250),
      );
    }
  }, [on, at, shell]);

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
      if (target?.closest(step.target.replaceAll("||", ","))) setAt((a) => (a === at ? a + 1 : a));
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
          <span className="k-sr">
            {at + 1} of {STEPS.length}
          </span>
          <span className="tour-dots" aria-hidden>
            {STEPS.map((_, k) => (
              <i key={k} data-on={k === at || undefined} data-done={k < at || undefined} />
            ))}
          </span>
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
          {step.tap ? <span className="tour-try">Try it</span> : null}
          <Button variant={step.tap ? "ghost" : "primary"} size="sm" onClick={next}>
            {last ? "Done" : (step.go ?? "Next")}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
