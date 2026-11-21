/**
 * The word panel as a bottom sheet below 900px: it opens at a small peek (the word with its
 * article, the short meaning, play, and the two main buttons: `.k-inspector-peek`), a drag up
 * (or the handle) expands it to the full details, a drag down goes back to the peek and then
 * closes it, and a tap outside it closes it (a tap on another word just shows that word).
 * Wider screens keep the side panel: nothing here runs there.
 *
 * The peek's height is measured, not guessed: the bottom of `.k-inspector-peek` in the sheet,
 * a gap, and the sheet's bottom padding (`--safe-bottom`), so the buttons always end above the
 * gesture line. It is written to `--sheet-peek` on the panel.
 */
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export type SheetSize = "peek" | "full";

const SHEET_QUERY = "(max-width: 899px)";
/** Space (px) between the peek's buttons and the bottom of the sheet's visible part. */
const PEEK_GAP = 16;
/** Without a peek part (loading, an error) the sheet shows at most this share of the screen. */
const PEEK_FALLBACK = 0.3;
/** A drag this far (px) is a decision; less springs back. */
const DRAG_DECIDES = 56;
/** Taps on these keep the sheet open: other words, and menus the sheet opened. */
const KEEP_OPEN = [
  ".k-tok",
  ".k-word-chip",
  ".k-sbs",
  "[data-radix-popper-content-wrapper]",
  "[role=dialog]",
  "[role=menu]",
].join(",");

function isSheet(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.(SHEET_QUERY).matches;
}

export function useBottomSheet(
  panel: RefObject<HTMLElement | null>,
  open: boolean,
  close: () => void,
): { size: SheetSize; toggle: () => void } {
  const [size, setSize] = useState<SheetSize>("peek");
  // Every opening starts at the peek (adjusted while rendering, not in an effect).
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setSize("peek");
  }
  const sizeRef = useRef(size);
  useLayoutEffect(() => {
    sizeRef.current = size;
  }, [size]);

  // The peek's height, measured from its content (and again whenever the content changes).
  useEffect(() => {
    const el = panel.current;
    if (!el || !open) return;
    const measure = () => {
      if (!isSheet()) {
        el.style.removeProperty("--sheet-peek");
        return;
      }
      const top = el.getBoundingClientRect().top;
      const offset = el.querySelector(".inspector-scroll")?.scrollTop ?? 0;
      const pad = parseFloat(getComputedStyle(el).paddingBottom) || 0;
      const peek = el.querySelector(".k-inspector-peek");
      const end = peek ?? el.querySelector(".inspector-body");
      if (!end) return;
      let height = end.getBoundingClientRect().bottom - top + offset + PEEK_GAP + pad;
      if (!peek) height = Math.min(height, window.innerHeight * PEEK_FALLBACK);
      el.style.setProperty("--sheet-peek", `${Math.ceil(height)}px`);
    };
    measure();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    const body = el.querySelector(".inspector-body");
    if (ro && body) ro.observe(body);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [open, panel]);

  // Back at the peek, the details start from their top again.
  useEffect(() => {
    if (size !== "peek") return;
    const scroll = panel.current?.querySelector(".inspector-scroll");
    if (scroll) scroll.scrollTop = 0;
  }, [size, panel]);

  // A tap outside the sheet closes it.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const el = panel.current;
      const target = e.target as Element | null;
      if (!el || !target || !isSheet() || el.contains(target)) return;
      if (target.closest(KEEP_OPEN)) return;
      close();
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [open, close, panel]);

  // Drags: on the handle and head always; on the body when it is at its top (or in the peek).
  useEffect(() => {
    const el = panel.current;
    if (!el || !open) return;
    let start: { y: number; id: number } | null = null;
    let dy = 0;
    const onDown = (e: PointerEvent) => {
      if (!isSheet() || e.button !== 0) return;
      const target = e.target as Element;
      const grip = !!target.closest(".sheet-grip, .inspector-head");
      const body = el.querySelector(".inspector-scroll");
      const atTop = !body || body.scrollTop <= 0;
      if (!grip && !(sizeRef.current === "peek" || atTop)) return;
      if (!grip && target.closest("button, a, input, select, textarea, [role=slider]")) return;
      start = { y: e.clientY, id: e.pointerId };
      dy = 0;
    };
    const onMove = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      dy = e.clientY - start.y;
      const body = el.querySelector(".inspector-scroll");
      // Scrolling the full details up is a scroll, not a drag.
      if (sizeRef.current === "full" && dy < 0) return;
      if (sizeRef.current === "full" && dy > 0 && body && body.scrollTop > 0) {
        start = null;
        return;
      }
      if (Math.abs(dy) < 6) return;
      el.dataset["dragging"] = "";
      el.style.setProperty("--sheet-drag", `${Math.max(dy, -120)}px`);
    };
    const onUp = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      start = null;
      delete el.dataset["dragging"];
      el.style.removeProperty("--sheet-drag");
      if (dy <= -DRAG_DECIDES) setSize("full");
      else if (dy >= DRAG_DECIDES) {
        if (sizeRef.current === "full") setSize("peek");
        else close();
      }
    };
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [open, close, panel]);

  const toggle = useCallback(() => setSize((s) => (s === "peek" ? "full" : "peek")), []);
  return { size, toggle };
}
