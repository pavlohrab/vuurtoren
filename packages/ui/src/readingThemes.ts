/**
 * Reading themes for the reader surface: token sets
 * applied as inline custom properties on the reader page, so the reading column changes while
 * the sidebar, top bar and inspector keep the app theme. Every pair is WCAG AA (text) and
 * every mark is at least 3:1 (checked in readingThemes.test.ts).
 */
export type ReadingThemeName = "paper" | "sepia" | "night";

export interface ReadingThemeTokens {
  scheme: "light" | "dark";
  bg: string;
  surface: string;
  surface2: string;
  ink: string;
  muted: string;
  line: string;
  lineStrong: string;
  accent: string;
  accentInk: string;
  accentSoft: string;
  known: string;
  knownInk: string;
  knownSoft: string;
  learn: string;
  learnInk: string;
  learnSoft: string;
  grammar: string;
  success: string;
  danger: string;
}

export const READING_THEME_TOKENS: Record<ReadingThemeName, ReadingThemeTokens> = {
  paper: {
    scheme: "light",
    bg: "#fbf9f4",
    surface: "#f5f1e9",
    surface2: "#ece6db",
    ink: "#26211c",
    muted: "#655c50",
    line: "#e2dbce",
    lineStrong: "#cec5b5",
    accent: "#87541b",
    accentInk: "#fbf9f4",
    accentSoft: "#f0e4d0",
    known: "#4a7a52",
    knownInk: "#3d6a45",
    knownSoft: "#e4ebdc",
    learn: "#b5643f",
    learnInk: "#94472a",
    learnSoft: "#f5e2d4",
    grammar: "#566f99",
    success: "#3d6a45",
    danger: "#a83a31",
  },
  sepia: {
    scheme: "light",
    bg: "#f3ead6",
    surface: "#eee3cb",
    surface2: "#e6d9bd",
    ink: "#3d3023",
    muted: "#6a5843",
    line: "#dccdb0",
    lineStrong: "#c9b692",
    accent: "#7f4e18",
    accentInk: "#f3ead6",
    accentSoft: "#e9d9b8",
    known: "#46704b",
    knownInk: "#3a6040",
    knownSoft: "#dfe2c8",
    learn: "#a85933",
    learnInk: "#894222",
    learnSoft: "#ecd3b9",
    grammar: "#52678c",
    success: "#3a6040",
    danger: "#9e352c",
  },
  night: {
    scheme: "dark",
    bg: "#0f0e0d",
    surface: "#161412",
    surface2: "#1d1a17",
    ink: "#c9c0b3",
    muted: "#8d8478",
    line: "#27231f",
    lineStrong: "#35302a",
    accent: "#c49558",
    accentInk: "#15100b",
    accentSoft: "#2a2117",
    known: "#88aa85",
    knownInk: "#88aa85",
    knownSoft: "#1a2119",
    learn: "#cf8b6a",
    learnInk: "#d39676",
    learnSoft: "#2f2019",
    grammar: "#8a9dc2",
    success: "#88aa85",
    danger: "#dc8274",
  },
};

/** The CSS custom properties of a reading theme (the same names as the app tokens). */
export function readingThemeStyle(name: ReadingThemeName): Record<string, string> {
  const t = READING_THEME_TOKENS[name];
  return {
    colorScheme: t.scheme,
    "--bg": t.bg,
    "--surface": t.surface,
    "--surface-2": t.surface2,
    "--ink": t.ink,
    "--ink-muted": t.muted,
    "--line": t.line,
    "--line-strong": t.lineStrong,
    "--hairline": `color-mix(in srgb, ${t.ink} 9%, transparent)`,
    "--accent": t.accent,
    "--accent-ink": t.accentInk,
    "--accent-soft": t.accentSoft,
    "--known": t.known,
    "--known-ink": t.knownInk,
    "--known-soft": t.knownSoft,
    "--learn": t.learn,
    "--learn-ink": t.learnInk,
    "--learn-soft": t.learnSoft,
    "--success": t.success,
    "--danger": t.danger,
    "--state-new-bg": t.learnSoft,
    "--state-new-line": t.learn,
    "--state-learning-line": `color-mix(in srgb, ${t.known} 80%, ${t.muted})`,
    "--state-gloss-line": t.accent,
    "--state-grammar-line": t.grammar,
  };
}
