/**
 * Reading comforts, remembered per device (localStorage): text size, line spacing, line width,
 * reading font, reading theme and whether cloze blanks show their meaning. Every read and write is guarded: blocked storage just means
 * the defaults.
 */
import { useCallback, useState } from "react";
import { readingThemeStyle } from "@app/ui";

export const TEXT_SIZES = [16, 17.5, 19.5, 22, 25] as const;
export const LEADINGS = { compact: 1.5, normal: 1.7, relaxed: 1.95 } as const;
export const WIDTHS = { narrow: "36rem", normal: "44rem", wide: "52rem" } as const;
export const FONTS = {
  literata: '"Literata Variable", Georgia, serif',
  inter: '"Inter Variable", system-ui, sans-serif',
  // Atkinson Hyperlegible Next has no Cyrillic: Cyrillic falls back to Inter glyph by glyph.
  atkinson: '"Atkinson Hyperlegible Next Variable", "Inter Variable", system-ui, sans-serif',
} as const;
export const READING_THEMES = ["app", "paper", "sepia", "night"] as const;

export interface ReaderPrefs {
  /** Index into TEXT_SIZES. */
  size: number;
  leading: keyof typeof LEADINGS;
  width: keyof typeof WIDTHS;
  font: keyof typeof FONTS;
  theme: (typeof READING_THEMES)[number];
  /** Cloze: show the blank's meaning above it while it has focus (the first, free hint). */
  clozeMeaning: boolean;
}

export const DEFAULT_PREFS: ReaderPrefs = {
  size: 2,
  leading: "normal",
  width: "normal",
  font: "literata",
  theme: "app",
  clozeMeaning: true,
};

const KEY = "kenning-reader-prefs";

const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

/** Stored preferences merged over the defaults; unknown or broken values are dropped. */
export function readPrefs(): ReaderPrefs {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const size = typeof v["size"] === "number" ? Math.round(v["size"]) : DEFAULT_PREFS.size;
    return {
      size: Math.min(TEXT_SIZES.length - 1, Math.max(0, size)),
      leading: pick(v["leading"], Object.keys(LEADINGS) as ReaderPrefs["leading"][], "normal"),
      width: pick(v["width"], Object.keys(WIDTHS) as ReaderPrefs["width"][], "normal"),
      font: pick(v["font"], Object.keys(FONTS) as ReaderPrefs["font"][], "literata"),
      theme: pick(v["theme"], READING_THEMES, "app"),
      clozeMeaning: typeof v["clozeMeaning"] === "boolean" ? v["clozeMeaning"] : true,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function writePrefs(p: ReaderPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage blocked: the change lasts for this visit */
  }
}

/** The preferences plus an updater that stores every change. */
export function useReaderPrefs(): [ReaderPrefs, (patch: Partial<ReaderPrefs>) => void] {
  const [prefs, setPrefs] = useState(readPrefs);
  const update = useCallback((patch: Partial<ReaderPrefs>) => {
    setPrefs((cur) => {
      const next = { ...cur, ...patch };
      next.size = Math.min(TEXT_SIZES.length - 1, Math.max(0, next.size));
      writePrefs(next);
      return next;
    });
  }, []);
  return [prefs, update];
}

/** CSS custom properties for the reader surface (and the reading theme's tokens). */
export function prefsStyle(p: ReaderPrefs): Record<string, string> {
  return {
    ...(p.theme !== "app" ? readingThemeStyle(p.theme) : {}),
    "--reader-size": `${TEXT_SIZES[p.size] ?? 19.5}px`,
    "--reader-leading": String(LEADINGS[p.leading]),
    "--measure": WIDTHS[p.width],
    "--font-reading": FONTS[p.font],
  };
}
