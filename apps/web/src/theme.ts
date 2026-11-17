import { useSyncExternalStore } from "react";

export type ThemeChoice = "system" | "light" | "dark";

const KEY = "kenning-theme";
const listeners = new Set<() => void>();

function isTheme(v: unknown): v is ThemeChoice {
  return v === "system" || v === "light" || v === "dark";
}

/** Read the persisted theme; falls back to "system" if storage is unavailable. */
export function readTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return isTheme(v) ? v : "system";
  } catch {
    return "system";
  }
}

/** Apply a theme to <html>; "system" removes the override so prefers-color-scheme decides. */
export function applyTheme(theme: ThemeChoice): void {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
}

let current: ThemeChoice = readTheme();

/** Persist and apply a theme choice. */
export function setTheme(theme: ThemeChoice): void {
  current = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* storage blocked; the choice still applies for this session */
  }
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
