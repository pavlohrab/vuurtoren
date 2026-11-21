/**
 * Back, overlay first: the system Back (Android's button or gesture) closes what is open on top
 * (a dialog, a menu, the word sheet, the More sheet, the tour); with nothing open it goes to the
 * start of the current tab (Read or Words; everything under More counts as Read), and from a
 * tab's start it leaves the app. Back never walks through the pages visited before.
 *
 * Overlays of the app say so with `useBackClose` while they are open; the last one opened is on
 * top. Dialogs, popovers and menus of `@app/ui` (Radix) are found in the page and closed with
 * Escape, as they would be from a keyboard: they always sit above the rest.
 */
import { useRouter } from "@tanstack/react-router";
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
export type BackResult = "overlay" | "tab" | "exit";

/** The start of the bottom-bar tab a path belongs to: Words for the word screens, else Read. */
export function tabRoot(pathname: string): "/" | "/words" {
  return /^\/(words|review|practice)(\/|$)/.test(pathname) ? "/words" : "/";
}

/** Pages Back leaves the app from: a tab's start, and the welcome steps. */
function isRoot(pathname: string): boolean {
  return pathname === "/" || pathname === "/words" || pathname.startsWith("/welcome");
}

/** One system Back: the topmost overlay, else the start of the tab, else out of the app. */
export function systemBack(
  pathname: string,
  nav: { toTab(root: "/" | "/words"): void; exit(): void },
): BackResult {
  if (closeTopmost()) return "overlay";
  if (!isRoot(pathname)) {
    nav.toTab(tabRoot(pathname));
    return "tab";
  }
  nav.exit();
  return "exit";
}

/** Take the Android Back for the app while the shell is mounted (no-op elsewhere). */
export function useSystemBack(): void {
  const router = useRouter();
  useEffect(() => {
    const back = desktopBridge()?.back;
    if (!back) return;
    return back.listen(() => {
      systemBack(router.state.location.pathname, {
        toTab: (to) => void router.navigate({ to, replace: true }),
        exit: () => void back.exit(),
      });
    });
  }, [router]);
}
