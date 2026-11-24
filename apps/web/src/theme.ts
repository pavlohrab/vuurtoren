import { useSyncExternalStore } from "react";
import { readLocal, writeLocal } from "./storage/local.js";

export type ThemeChoice = "system" | "light" | "dark";

const KEY = "vuurtoren-theme";
const listeners = new Set<() => void>();

function isTheme(v: unknown): v is ThemeChoice {
  return v === "system" || v === "light" || v === "dark";
}

/** Read the persisted theme; falls back to "system" if storage is unavailable. */
function readTheme(): ThemeChoice {
  const v = readLocal(KEY);
  return isTheme(v) ? v : "system";
}

const darkQuery = (): MediaQueryList | undefined =>
  typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : undefined;

/**
 * The Android app draws the status bar's clock and icons itself, dark or light by the phone's
 * theme, not the app's: with the app dark on a light phone they were black on black. Tell it.
 */
function tellStatusBar(theme: ThemeChoice): void {
  const dark = theme === "dark" || (theme === "system" && !!darkQuery()?.matches);
  try {
    window.VuurtorenInsets?.setDarkBars?.(dark);
  } catch {
    // Not in the Android app, or an older one without it.
  }
}

/** Apply a theme to <html>; "system" removes the override so prefers-color-scheme decides. */
function applyTheme(theme: ThemeChoice): void {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  tellStatusBar(theme);
}

let current: ThemeChoice = readTheme();

/** Persist and apply a theme choice. */
function setTheme(theme: ThemeChoice): void {
  current = theme;
  writeLocal(KEY, theme);
  applyTheme(theme);
  listeners.forEach((l) => l());
}

/** Apply the stored theme at startup. */
export function initTheme(): void {
  current = readTheme();
  applyTheme(current);
  // "As the phone": follow the phone when it switches between light and dark.
  darkQuery()?.addEventListener?.("change", () => tellStatusBar(current));
}

/** React hook returning the current theme and a setter. */
export function useTheme(): [ThemeChoice, (t: ThemeChoice) => void] {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
  return [theme, setTheme];
}
