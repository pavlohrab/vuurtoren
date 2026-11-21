/**
 * Back, overlay first: the system Back (Android's button or gesture) closes what is open on top
 * (a dialog, a menu, the word sheet, the More sheet, the tour) before the app goes back a page,
 * and leaves the app only when there is nothing to close and no page to go back to.
 *
 * Overlays of the app say so with `useBackClose` while they are open; the last one opened is on
 * top. Dialogs, popovers and menus of `@app/ui` (Radix) are found in the page and closed with
 * Escape, as they would be from a keyboard: they always sit above the rest.
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import { desktopBridge } from "../desktop/bridge.js";

type Close = () => void;

const stack: { close: Close }[] = [];

/** Put a close action on top of the Back stack; returns its removal. */
export function pushBack(close: Close): () => void {
  const entry = { close };
  stack.push(entry);
  return () => {
    const i = stack.lastIndexOf(entry);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** While `open`, Back calls `close` (the latest `close` given) before anything under it. */
export function useBackClose(open: boolean, close: Close): void {
  const latest = useRef(close);
  useLayoutEffect(() => {
    latest.current = close;
  });
  useEffect(() => {
    if (!open) return;
    return pushBack(() => latest.current());
  }, [open]);
}

/** An open Radix layer (dialog, popover, menu, select list), the topmost last. */
function openLayer(): Element | null {
  const layers = document.querySelectorAll(
    [
      "[role='dialog'][data-state='open']",
      "[role='alertdialog'][data-state='open']",
      "[data-radix-popper-content-wrapper]",
    ].join(", "),
  );
  return layers[layers.length - 1] ?? null;
}

/** Close the topmost overlay; false when nothing is open. */
export function closeTopmost(): boolean {
  const layer = openLayer();
  if (layer) {
    const from =
      document.activeElement && layer.contains(document.activeElement)
        ? document.activeElement
        : (layer.querySelector("[data-state='open']") ?? layer);
    from.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }),
    );
    return true;
  }
  const top = stack.at(-1);
  if (!top) return false;
  top.close();
  return true;
}

/** What one system Back did. */
export type BackResult = "overlay" | "page" | "exit";

/** One system Back: the topmost overlay, else the previous page, else out of the app. */
export function systemBack(canGoBack: boolean, nav: { back(): void; exit(): void }): BackResult {
  if (closeTopmost()) return "overlay";
  if (canGoBack) {
    nav.back();
    return "page";
  }
  nav.exit();
  return "exit";
}

/** Take the Android Back for the app while the shell is mounted (no-op elsewhere). */
export function useSystemBack(): void {
  useEffect(() => {
    const back = desktopBridge()?.back;
    if (!back) return;
    return back.listen(({ canGoBack }) => {
      systemBack(canGoBack, {
        back: () => window.history.back(),
        exit: () => void back.exit(),
      });
    });
  }, []);
}
