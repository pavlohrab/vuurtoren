/**
 * Reading comforts, remembered per device (localStorage): text size, line spacing, margins,
 * reading font, reading theme, whether cloze blanks show their meaning, when side by side
 * shows the English and where it comes from, and how pages turn (book mode, BookPages.tsx).
 * Every read and write is guarded: blocked storage just means the defaults.
 */
import { useCallback, useState } from "react";
import { readingThemeStyle } from "@app/ui";

export const TEXT_SIZES = [16, 17.5, 19.5, 22, 25] as const;
export const LEADINGS = { compact: 1.5, normal: 1.7, relaxed: 1.95 } as const;
export const MARGINS = ["narrow", "normal", "wide"] as const;
export type Margins = (typeof MARGINS)[number];
/** Scrolling, and a single book page on a computer: the line length. Wide margins, short lines. */
export const MEASURES: Record<Margins, string> = {
  narrow: "52rem",
  normal: "44rem",
  wide: "36rem",
};
/** A book page on a phone: the space at each side, in px. */
export const SIDE_MARGINS: Record<Margins, number> = { narrow: 14, normal: 22, wide: 34 };
/** One page of a two-page spread: the widest its text gets, in px. */
export const SPREAD_PAGES: Record<Margins, number> = { narrow: 512, normal: 448, wide: 384 };
export const PAGE_MODES = ["turn", "scroll"] as const;
/** How a page turns in book mode. */
export const TURN_STYLES = ["paper", "follow", "fade", "none"] as const;
const FONTS = {
  literata: '"Literata Variable", Georgia, serif',
  inter: '"Inter Variable", system-ui, sans-serif',
  // Atkinson Hyperlegible Next has no Cyrillic: Cyrillic falls back to Inter glyph by glyph.
  atkinson: '"Atkinson Hyperlegible Next Variable", "Inter Variable", system-ui, sans-serif',
} as const;
export const READING_THEMES = ["app", "paper", "sepia", "night"] as const;
/** Side by side: always, only sentences you know less than 85% of, or on request. */
export const ENGLISH_VISIBILITY = ["always", "hard", "tap"] as const;

export interface ReaderPrefs {
  /** Index into TEXT_SIZES. */
  size: number;
  leading: keyof typeof LEADINGS;
  /** Narrow margins give long lines, wide ones short lines (it was "Line width"). */
  margins: Margins;
  font: keyof typeof FONTS;
  theme: (typeof READING_THEMES)[number];
  /** Cloze: show the blank's meaning above it while it has focus (the first, free hint). */
  clozeMeaning: boolean;
  /** Side by side: when a sentence's English shows. */
  english: (typeof ENGLISH_VISIBILITY)[number];
  /** Side by side: the English comes from the AI provider (when one is set up). */
  englishAI: boolean;
  /** Turn pages like a book, or scroll. */
  pages: (typeof PAGE_MODES)[number];
  /** Two pages side by side when the screen is wide enough. */
  spread: boolean;
  turn: (typeof TURN_STYLES)[number];
  /** Book mode: justified text with hyphens. */
  justify: boolean;
  /** Android: the volume keys turn pages while the reader is open. */
  volumeKeys: boolean;
}

export const DEFAULT_PREFS: ReaderPrefs = {
  size: 2,
  leading: "normal",
  margins: "normal",
  font: "literata",
  theme: "app",
  clozeMeaning: true,
  english: "hard",
  englishAI: false,
  pages: "turn",
  spread: true,
  turn: "paper",
  justify: true,
  volumeKeys: false,
};

const KEY = "vuurtoren-reader-prefs";

const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

/** Stored preferences merged over the defaults; unknown or broken values are dropped. */
export function readPrefs(): ReaderPrefs {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const size = typeof v["size"] === "number" ? Math.round(v["size"]) : DEFAULT_PREFS.size;
    // Before Margins there was "Line width": a wide line is narrow margins.
    const oldWidth = v["width"] === "wide" ? "narrow" : v["width"] === "narrow" ? "wide" : "normal";
    const bool = (k: keyof ReaderPrefs) =>
      typeof v[k] === "boolean" ? (v[k] as boolean) : (DEFAULT_PREFS[k] as boolean);
    return {
      size: Math.min(TEXT_SIZES.length - 1, Math.max(0, size)),
      leading: pick(v["leading"], Object.keys(LEADINGS) as ReaderPrefs["leading"][], "normal"),
      margins: pick(v["margins"], MARGINS, oldWidth),
      font: pick(v["font"], Object.keys(FONTS) as ReaderPrefs["font"][], "literata"),
      theme: pick(v["theme"], READING_THEMES, "app"),
      clozeMeaning: typeof v["clozeMeaning"] === "boolean" ? v["clozeMeaning"] : true,
      english: pick(v["english"], ENGLISH_VISIBILITY, "hard"),
      englishAI: v["englishAI"] === true,
      pages: pick(v["pages"], PAGE_MODES, "turn"),
      spread: bool("spread"),
      // "flip" (the 3D page turn) became "paper"; anything unknown is the default.
      turn: pick(v["turn"], TURN_STYLES, "paper"),
      justify: bool("justify"),
      volumeKeys: bool("volumeKeys"),
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
    "--measure": MEASURES[p.margins],
    "--font-reading": FONTS[p.font],
  };
}
