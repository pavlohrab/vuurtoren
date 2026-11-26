/**
 * Book mode: one reader page flowed into CSS columns, one screen at a time (mock-reader-book).
 * A screen is one column on a phone, or two side by side (a spread) on a wide screen. Turning
 * moves the text sideways by one screen; past the last screen the reader goes on to the next
 * page (`onLeave`). The arithmetic is in bookMath.ts; algorithms.md 3 explains it.
 *
 * The page is measured again whenever its room or its content changes (text size, margins,
 * glosses, the English line, a turned phone), and stays on the screen that holds the word
 * the reader was on (`anchor`).
 *
 * Turn styles: the page follows the finger, a 3D page turn, a fade, or none. A turn that
 * needs the old screen on top (page turn, fade, and every move to another page) uses a copy
 * of it, a "leaf", that lives only for the animation.
 */
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import {
  type BookLayout,
  bookLayout,
  firstOnScreen,
  fitsSpread,
  itemAtChar,
  screenAt,
  screenCount,
} from "./bookMath.js";
import { clipOf, fold, foldShading, type Pt } from "./paperFold.js";
import { MEASURES, type ReaderPrefs, SIDE_MARGINS, SPREAD_PAGES } from "./readerPrefs.js";

/** The fold between the two pages of a spread, in px. */
const FOLD = 72;
/** A spread needs two pages at least this wide. */
const MIN_SPREAD_PAGE = 300;
/** Below this the stage is a phone: side margins from the setting. */
const PHONE = 700;
/** Swipes that start this close to the screen's edge belong to Android's back gesture. */
const EDGE = 20;
const EASE = "cubic-bezier(.2,.8,.2,1)";
const SLIDE_MS = 300;
/** The paper turn, from the corner to the far side. */
const PAPER_MS = 480;
const FADE_MS = 180;
/** Taps on these are the element's own (a word, a blank, a link, the practise card). */
const OWN_TAP =
  ".k-tok, [data-tok], a, button, input, textarea, select, label, [role=button], [role=slider], .k-gmark, .page-end, .k-popover, [contenteditable=true]";
const NO_SWIPE = "input, textarea, select, [role=slider], .k-popover";

export interface BookScreen {
  screen: number;
  screens: number;
  /** Token index of the first word on the screen (null while there is none). */
  anchor: number | null;
}

export interface BookHandle {
  /** One screen on (1) or back (-1); at the ends, on to the next or previous page. */
  turn(dir: 1 | -1): void;
  /** Leave this page with one slide: `go` changes the page, the new one opens on `land`. */
  leave(dir: 1 | -1, go: () => void, land: "first" | "last"): void;
  /** Straight to screen `n` of this page (the scrub bar), in one move. */
  go(n: number): void;
}

interface Pending {
  dir: 1 | -1;
  leaf: HTMLElement | null;
  land: "first" | "last";
  dx: number;
  timer: number;
}

interface Props {
  /** Changes whenever the page's content is replaced (another page, a new plan, a mode). */
  pageKey: string;
  /** Changes with anything that moves the text without replacing it (size, margins, …). */
  layoutKey: string;
  prefs: ReaderPrefs;
  lang: string;
  /** Open this page on the word at `char` (the saved place), once. */
  start: { pageKey: string; char: number } | null;
  /** The character offset of token `i`, for the saved place. */
  charOf: (i: number) => number | undefined;
  canLeave: (dir: 1 | -1) => boolean;
  onLeave: (dir: 1 | -1) => void;
  onScreen: (s: BookScreen) => void;
  /** A tap in the middle that is not on a word: hide or show the bars. */
  onMiddle: () => void;
  /** Lift the text by this much, so a word stays above the word sheet (px). */
  lift: number;
  handle: RefObject<BookHandle | null>;
  children: ReactNode;
}

const reducedMotion = (): boolean =>
  typeof window.matchMedia !== "function" ||
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Run a Web Animation and wait for it (at once where there are none, as in tests). */
function play(el: Element, frames: Keyframe[], ms: number, easing = EASE): Promise<void> {
  if (typeof el.animate !== "function" || ms <= 0) return Promise.resolve();
  const a = el.animate(frames, { duration: ms, easing });
  return a.finished.then(
    () => undefined,
    () => undefined,
  );
}

const shift = (x: number) => `translate3d(${x}px,0,0)`;

/** The first background colour that isn't transparent, from `el` up (the paper's colour). */
function backgroundOf(el: Element | null): string {
  for (let e = el; e; e = e.parentElement) {
    const c = getComputedStyle(e).backgroundColor;
    if (c && c !== "transparent" && !/rgba\([^)]*,\s*0\)$/.test(c)) return c;
  }
  return "rgb(251, 248, 242)";
}
/** Roughly how light a CSS rgb() colour is, 0 to 1. */
function lightness(c: string): number {
  const m = c.match(/[\d.]+/g)?.map(Number) ?? [255, 255, 255];
  return (0.2126 * (m[0] ?? 0) + 0.7152 * (m[1] ?? 0) + 0.0722 * (m[2] ?? 0)) / 255;
}

function remPx(rem: string): number {
  const root = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  return parseFloat(rem) * root;
}

export function BookPages(props: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLSpanElement>(null);
  const leavesRef = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });
  const st = useRef({
    layout: null as BookLayout | null,
    stageW: 0,
    screen: 0,
    screens: 1,
    anchor: null as number | null,
    startChar: null as number | null,
    usedStart: "",
    busy: false,
    pending: null as Pending | null,
    lastReport: "",
  });

  const offset = (screen: number) => -screen * (st.current.layout?.step ?? 0);
  const place = (dx = 0) => {
    const flow = flowRef.current;
    if (flow) flow.style.transform = shift(offset(st.current.screen) + dx);
  };
  const style = (): ReaderPrefs["turn"] => (reducedMotion() ? "none" : latest.current.prefs.turn);

  /** The page's words in reading order. */
  const words = () =>
    Array.from(flowRef.current?.querySelectorAll<HTMLElement>(".k-tok[data-i]") ?? []);

  /** The screen an element is on, measured from the text's start. */
  const screenOf = (el: Element) => {
    const s = st.current;
    const flow = flowRef.current;
    if (!flow || !s.layout) return 0;
    const x = el.getBoundingClientRect().left - flow.getBoundingClientRect().left;
    return screenAt(x, s.layout.step, s.screens);
  };

  const report = () => {
    const s = st.current;
    const key = `${s.screen}/${s.screens}/${s.anchor}`;
    if (key === s.lastReport) return;
    s.lastReport = key;
    latest.current.onScreen({ screen: s.screen, screens: s.screens, anchor: s.anchor });
  };

  /** After a turn: remember the first word on the screen. */
  const settle = () => {
    const s = st.current;
    const list = words();
    const k = firstOnScreen(list.length, (i) => screenOf(list[i]!), s.screen);
    const i = k >= 0 ? Number(list[k]!.dataset["i"]) : NaN;
    s.anchor = Number.isFinite(i) ? i : s.anchor;
    report();
  };

  /** Lay the page out for the room it has, then find the screen it should be on. */
  const measure = () => {
    const s = st.current;
    const stage = stageRef.current;
    const flow = flowRef.current;
    const end = endRef.current;
    if (!stage || !flow || !end) return;
    const w = stage.clientWidth;
    if (!w) return;
    const p = latest.current.prefs;
    const phone = w < PHONE;
    const margin = phone ? SIDE_MARGINS[p.margins] : 32;
    const wide = window.innerWidth >= 1100 || window.innerWidth > window.innerHeight;
    const spread = p.spread && wide && !phone && fitsSpread(w, MIN_SPREAD_PAGE, FOLD, margin);
    const maxPage = spread ? SPREAD_PAGES[p.margins] : phone ? w : remPx(MEASURES[p.margins]);
    const l = bookLayout({ stage: w, spread, margin, maxPage, fold: FOLD });
    s.layout = l;
    s.stageW = w;
    stage.style.setProperty("--book-col", `${l.col}px`);
    stage.style.setProperty("--book-gap", `${l.gap}px`);
    stage.style.setProperty("--book-vw", `${l.viewport}px`);
    stage.style.setProperty("--book-side", `${l.side}px`);
    stage.style.setProperty("--book-per", String(l.perScreen));
    if (spread) stage.dataset["spread"] = "";
    else delete stage.dataset["spread"];
    const x = end.getBoundingClientRect().left - flow.getBoundingClientRect().left;
    s.screens = screenCount(x, l.step);
    let target = s.screen;
    if (s.pending) {
      target = s.pending.land === "first" ? 0 : s.screens - 1;
    } else if (s.startChar !== null) {
      const list = words();
      const starts = list.map((el) => latest.current.charOf(Number(el.dataset["i"])) ?? 0);
      const k = itemAtChar(starts, s.startChar);
      s.startChar = null;
      if (k >= 0) {
        target = screenOf(list[k]!);
        s.anchor = Number(list[k]!.dataset["i"]);
      }
    } else if (s.anchor !== null) {
      const el = flow.querySelector(`.k-tok[data-i="${s.anchor}"]`);
      if (el) target = screenOf(el);
    }
    s.screen = Math.min(s.screens - 1, Math.max(0, target));
    if (!s.busy || s.pending) place();
    if (s.anchor === null) settle();
    else report();
  };

  /** A copy of the page as it shows `screen`, laid over it for an animation. */
  const leafAt = (screen: number): HTMLElement | null => {
    const inner = innerRef.current;
    const leaves = leavesRef.current;
    if (!inner || !leaves) return null;
    const leaf = inner.cloneNode(true) as HTMLElement;
    leaf.className = "book-leaf";
    leaf.setAttribute("aria-hidden", "true");
    leaf.inert = true;
    for (const el of leaf.querySelectorAll("[id]")) el.removeAttribute("id");
    const flow = leaf.querySelector<HTMLElement>(".book-flow");
    if (flow) flow.style.transform = shift(offset(screen));
    const vp = leaf.querySelector<HTMLElement>(".book-vp");
    if (vp) vp.style.transform = "none";
    const shade = document.createElement("div");
    shade.className = "book-leaf-shade";
    leaf.append(shade);
    leaves.append(leaf);
    return leaf;
  };

  const clearLeaves = () => leavesRef.current?.replaceChildren();

  /**
   * The paper turn (paperFold.ts): `leaf`, the old screen laid over the new one, folds away from
   * its corner on the side it turns to. On a phone the flap is the plain back of the paper; on a
   * spread `back`, the new spread, shows through the flap (the next page lands where it falls).
   */
  interface PaperRig {
    leaf: HTMLElement;
    back: HTMLElement | null;
    svg: SVGSVGElement;
    dir: 1 | -1;
    w: number;
    h: number;
    c: Pt;
    spread: boolean;
    paper: string;
    dark: boolean;
  }
  const paperRig = (
    dir: 1 | -1,
    leaf: HTMLElement,
    backScreen: number,
    corner: "top" | "bottom",
  ): PaperRig | null => {
    const stage = stageRef.current;
    const leaves = leavesRef.current;
    if (!stage || !leaves) return null;
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    const spread = (st.current.layout?.perScreen ?? 1) === 2;
    const back = spread ? leafAt(backScreen) : null;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "book-fold");
    leaves.append(svg);
    const paper = backgroundOf(stage);
    return {
      leaf,
      back,
      svg,
      dir,
      w,
      h,
      c: [dir > 0 ? w : 0, corner === "bottom" ? h : 0],
      spread,
      paper,
      dark: lightness(paper) < 0.4,
    };
  };
  /** Where the corner goes for the page to be gone. */
  const paperEnd = (r: PaperRig): Pt => {
    const far = r.spread ? r.w / 2 + 2 : r.w * 1.05;
    return [r.dir > 0 ? r.c[0] - 2 * far : r.c[0] + 2 * far, r.c[1]];
  };
  const paperFrame = (r: PaperRig, p: Pt) => {
    const half = r.w / 2;
    // On a spread only the page on the turning side folds; the other page stays whole.
    const [x0, pw] = r.spread ? (r.dir > 0 ? [half, half] : [0, half]) : [0, r.w];
    const f = fold(pw, r.h, x0, r.c, p);
    let keep = f.keep;
    if (r.spread && keep.length > 2) {
      if (r.dir > 0) keep = [[0, 0], ...keep, [0, r.h]];
      else {
        const k = keep.findIndex((q) => Math.abs(q[0] - half) < 0.5 && q[1] < 0.5);
        if (k >= 0) keep = [...keep.slice(0, k + 1), [r.w, 0], [r.w, r.h], ...keep.slice(k + 1)];
      }
    } else if (r.spread)
      keep =
        r.dir > 0
          ? [
              [0, 0],
              [half, 0],
              [half, r.h],
              [0, r.h],
            ]
          : [
              [half, 0],
              [r.w, 0],
              [r.w, r.h],
              [half, r.h],
            ];
    r.leaf.style.clipPath = clipOf(keep);
    if (r.back) r.back.style.clipPath = clipOf(f.flap);
    r.svg.innerHTML = foldShading(f, r.back ? null : r.paper, r.dark);
  };
  /** Move the corner from `a` to `b`, easing out. */
  const paperMove = (r: PaperRig, a: Pt, b: Pt, ms: number) =>
    new Promise<void>((done) => {
      const t0 = performance.now();
      const frame = (t: number) => {
        const k = Math.min(1, (t - t0) / ms);
        const e = 1 - (1 - k) ** 3;
        paperFrame(r, [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e]);
        if (k < 1) requestAnimationFrame(frame);
        else done();
      };
      requestAnimationFrame(frame);
    });
  /** A tap's turn: the corner lifts a little and the page folds away. */
  const paperTurn = async (dir: 1 | -1, leaf: HTMLElement, backScreen: number) => {
    const r = paperRig(dir, leaf, backScreen, "bottom");
    if (!r) return;
    const lift: Pt = [r.c[0] - r.dir * 2, r.c[1] - 2];
    await paperMove(r, lift, paperEnd(r), PAPER_MS);
  };

  /** One screen on or back, within this page. `dx`: where a drag left the text. */
  const within = async (dir: 1 | -1, dx: number) => {
    const s = st.current;
    const flow = flowRef.current;
    if (!flow) return;
    const from = s.screen;
    const to = from + dir;
    const how = style();
    s.busy = true;
    try {
      if (how === "follow") {
        s.screen = to;
        place();
        const step = s.layout?.step ?? 1;
        const ms = Math.max(140, SLIDE_MS * (1 - Math.min(1, Math.abs(dx) / step)));
        await play(
          flow,
          [{ transform: shift(offset(from) + dx) }, { transform: shift(offset(to)) }],
          ms,
        );
      } else if (how === "paper" || how === "fade") {
        const oldLeaf = leafAt(from);
        s.screen = to;
        place();
        if (oldLeaf && how === "paper") await paperTurn(dir, oldLeaf, to);
        else if (oldLeaf) await play(oldLeaf, [{ opacity: 1 }, { opacity: 0 }], FADE_MS, "linear");
        clearLeaves();
      } else {
        s.screen = to;
        place();
      }
    } finally {
      s.busy = false;
    }
    settle();
  };

  /** Nothing further this way: the page pulls back a little. */
  const bump = (dir: 1 | -1, dx: number) => {
    const flow = flowRef.current;
    if (!flow) return;
    place();
    if (reducedMotion()) return;
    const at = offset(st.current.screen);
    void play(
      flow,
      [
        { transform: shift(at + dx) },
        { transform: shift(at - dir * 18) },
        { transform: shift(at) },
      ],
      260,
    );
  };

  const leave = (dir: 1 | -1, go: () => void, land: "first" | "last", dx = 0) => {
    const s = st.current;
    if (s.busy) return;
    const how = style();
    const leaf = how === "none" || !s.layout ? null : leafAt(s.screen);
    if (leaf && how === "follow") leaf.style.transform = shift(dx);
    place();
    s.busy = true;
    const timer = window.setTimeout(() => {
      // The page did not change (saving it failed): put everything back.
      if (s.pending?.timer !== timer) return;
      s.pending = null;
      s.busy = false;
      clearLeaves();
      place();
    }, 2500);
    s.pending = { dir, leaf, land, dx, timer };
    go();
  };

  /** The new page is laid out: bring it in over the leaf of the old one. */
  const arrive = async (p: Pending) => {
    const s = st.current;
    const flow = flowRef.current;
    window.clearTimeout(p.timer);
    s.pending = null;
    try {
      const how = style();
      if (!p.leaf || !flow || how === "none") return;
      if (how === "follow") {
        const w = s.stageW;
        const at = offset(s.screen);
        await Promise.all([
          play(p.leaf, [{ transform: shift(p.dx) }, { transform: shift(-p.dir * w) }], SLIDE_MS),
          play(
            flow,
            [{ transform: shift(at + p.dir * w + p.dx) }, { transform: shift(at) }],
            SLIDE_MS,
          ),
        ]);
      } else if (how === "paper") {
        await paperTurn(p.dir, p.leaf, s.screen);
      } else {
        await play(p.leaf, [{ opacity: 1 }, { opacity: 0 }], FADE_MS, "linear");
      }
    } finally {
      clearLeaves();
      s.busy = false;
      settle();
    }
  };

  const turn = (dir: 1 | -1, dx = 0) => {
    const s = st.current;
    if (s.busy) return;
    const to = s.screen + dir;
    if (!s.layout || to < 0 || to >= s.screens) {
      if (latest.current.canLeave(dir)) {
        leave(dir, () => latest.current.onLeave(dir), dir > 0 ? "first" : "last", dx);
      } else bump(dir, dx);
      return;
    }
    void within(dir, dx);
  };

  useImperativeHandle(props.handle, () => ({
    turn: (dir) => turn(dir),
    leave: (dir, go, land) => leave(dir, go, land),
    go: (n) => {
      const s = st.current;
      if (s.busy || !s.layout) return;
      const to = Math.max(0, Math.min(s.screens - 1, n));
      if (to === s.screen) return;
      const flow = flowRef.current;
      s.screen = to;
      place();
      if (flow && style() !== "none")
        void play(flow, [{ opacity: 0.4 }, { opacity: 1 }], FADE_MS, "linear");
      settle();
    },
  }));

  // A new page: start at its first screen (or where the move from the last one says).
  useLayoutEffect(() => {
    const s = st.current;
    s.screen = 0;
    s.anchor = null;
    s.lastReport = "";
    const start = latest.current.start;
    if (start && start.pageKey === props.pageKey && s.usedStart !== start.pageKey) {
      s.usedStart = start.pageKey;
      s.startChar = start.char;
    }
    measure();
    if (s.pending) void arrive(s.pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs per page
  }, [props.pageKey]);

  // The same page, laid out again.
  useLayoutEffect(() => {
    measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs per layout change
  }, [props.layoutKey]);

  // Changes in size or content: measure again on the next frame (once per frame).
  useEffect(() => {
    const stage = stageRef.current;
    const flow = flowRef.current;
    if (!stage || !flow) return;
    let frame = 0;
    const soon = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(soon) : null;
    ro?.observe(stage);
    const mo = new MutationObserver(soon);
    mo.observe(flow, { childList: true, subtree: true, characterData: true });
    void document.fonts?.ready.then(soon);
    return () => {
      ro?.disconnect();
      mo.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- set up once
  }, []);

  // Keyboard focus on a word on another screen (Tab, the arrow keys in the text): go there.
  useEffect(() => {
    const flow = flowRef.current;
    if (!flow) return;
    const onFocus = (e: FocusEvent) => {
      const s = st.current;
      if (s.busy || !(e.target instanceof Element)) return;
      const n = screenOf(e.target);
      if (n === s.screen) return;
      s.screen = n;
      place();
      settle();
    };
    flow.addEventListener("focusin", onFocus);
    return () => flow.removeEventListener("focusin", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- set up once
  }, []);

  // Swipes (the page follows the finger in that style) and taps on the sides or the middle.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let start: { x: number; y: number; t: number; id: number; mouse: boolean } | null = null;
    let dragging = false;
    let shown = 0;
    let swallow = false;
    /** A paper turn that follows the finger, within this page. */
    let paperDrag: { rig: PaperRig; from: number; to: number; p: Pt } | null = null;
    const local = (e: PointerEvent): Pt => {
      const r = stage.getBoundingClientRect();
      return [e.clientX - r.left, Math.max(0, Math.min(r.height, e.clientY - r.top))];
    };
    const resist = (dx: number) => {
      const s = st.current;
      const dir: 1 | -1 = dx < 0 ? 1 : -1;
      const to = s.screen + dir;
      const end = (to < 0 || to >= s.screens) && !latest.current.canLeave(dir);
      return end ? dx * 0.25 : dx;
    };
    const onDown = (e: PointerEvent) => {
      if (!e.isPrimary || e.button !== 0) return;
      if ((e.target as Element).closest(NO_SWIPE)) return;
      if (e.clientX < EDGE || e.clientX > window.innerWidth - EDGE) return;
      start = {
        x: e.clientX,
        y: e.clientY,
        t: e.timeStamp,
        id: e.pointerId,
        mouse: e.pointerType === "mouse",
      };
      dragging = false;
      shown = 0;
    };
    const onMove = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!dragging) {
        if (start.mouse) return;
        if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) {
          start = null;
          return;
        }
        if (Math.abs(dx) < 10 || Math.abs(dx) < 1.5 * Math.abs(dy)) return;
        dragging = true;
      }
      if (style() === "paper") {
        const s = st.current;
        if (!paperDrag) {
          const dir: 1 | -1 = dx < 0 ? 1 : -1;
          const to = s.screen + dir;
          // Past this page's screens the turn plays on release (the next page isn't laid out).
          if (s.busy || !s.layout || to < 0 || to >= s.screens) return;
          const leaf = leafAt(s.screen);
          if (!leaf) return;
          const rig = paperRig(
            dir,
            leaf,
            to,
            start.y - stage.getBoundingClientRect().top > stage.clientHeight / 2 ? "bottom" : "top",
          );
          if (!rig) return;
          s.busy = true;
          paperDrag = { rig, from: s.screen, to, p: rig.c };
          s.screen = to;
          place();
        }
        paperDrag.p = local(e);
        paperFrame(paperDrag.rig, paperDrag.p);
        return;
      }
      if (st.current.busy || style() !== "follow") return;
      shown = resist(dx);
      place(shown);
    };
    const onUp = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const s = start;
      start = null;
      if (!dragging) return;
      dragging = false;
      swallow = true;
      window.setTimeout(() => (swallow = false), 400);
      const dx = e.clientX - s.x;
      const width = st.current.layout?.viewport ?? stage.clientWidth;
      const far = Math.abs(dx) > width / 3;
      const flick = Math.abs(dx) > 30 && e.timeStamp - s.t < 250;
      if (paperDrag) {
        const d = paperDrag;
        paperDrag = null;
        const r = d.rig;
        const past = r.dir > 0 ? d.p[0] < r.w / 2 : d.p[0] > r.w / 2;
        const on = past || (flick && Math.sign(-dx) === r.dir);
        void paperMove(r, d.p, on ? paperEnd(r) : r.c, on ? 300 : 220).then(() => {
          if (!on) {
            st.current.screen = d.from;
            place();
          }
          clearLeaves();
          st.current.busy = false;
          settle();
        });
        return;
      }
      if ((far || flick) && !st.current.busy) turn(dx < 0 ? 1 : -1, shown);
      else if (shown) {
        const flow = flowRef.current;
        const at = offset(st.current.screen);
        place();
        if (flow)
          void play(flow, [{ transform: shift(at + shown) }, { transform: shift(at) }], 220);
      }
    };
    const onCancel = () => {
      if (dragging && shown) place();
      start = null;
      dragging = false;
    };
    const onClick = (e: MouseEvent) => {
      if (swallow) {
        swallow = false;
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      if (e.defaultPrevented || !(e.target instanceof Element)) return;
      if (e.target.closest(OWN_TAP)) return;
      if (window.getSelection()?.toString()) return;
      const r = stage.getBoundingClientRect();
      const x = (e.clientX - r.left) / Math.max(1, r.width);
      if (x < 1 / 3) turn(-1);
      else if (x > 2 / 3) turn(1);
      else latest.current.onMiddle();
    };
    stage.addEventListener("pointerdown", onDown);
    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerup", onUp);
    stage.addEventListener("pointercancel", onCancel);
    stage.addEventListener("click", onClick, true);
    return () => {
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onCancel);
      stage.removeEventListener("click", onClick, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- set up once
  }, []);

  useEffect(() => () => clearLeaves(), []);

  return (
    <div
      ref={stageRef}
      className="book"
      style={{ "--book-lift": `${props.lift}px` } as CSSProperties}
    >
      <div ref={innerRef} className="book-inner">
        <div className="book-paper" aria-hidden />
        <div className="book-vp">
          <div
            ref={flowRef}
            className="book-flow"
            lang={props.lang}
            {...(props.prefs.justify ? { "data-justify": "" } : {})}
          >
            {props.children}
            <span ref={endRef} className="book-end" aria-hidden />
          </div>
        </div>
      </div>
      <div ref={leavesRef} className="book-leaves" aria-hidden />
    </div>
  );
}
