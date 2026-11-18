import { useSyncExternalStore } from "react";
import { readLocal, writeLocal } from "./storage/local.js";

export type ThemeChoice = "system" | "light" | "dark";

const KEY = "kenning-theme";
const listeners = new Set<() => void>();

function isTheme(v: unknown): v is ThemeChoice {
  return v === "system" || v === "light" || v === "dark";
}

/** Read the persisted theme; falls back to "system" if storage is unavailable. */
function readTheme(): ThemeChoice {
  const v = readLocal(KEY);
  return isTheme(v) ? v : "system";
}

/** Apply a theme to <html>; "system" removes the override so prefers-color-scheme decides. */
function applyTheme(theme: ThemeChoice): void {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
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
